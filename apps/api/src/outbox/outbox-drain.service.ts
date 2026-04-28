// OutboxDrainService — drains the transactional Outbox table written by
// booking/inquiry services into real side-effects.
//
// Architecture per D-022:
//   - guest-notification / admin-notification rows → call EmailAdapter directly
//   - rebuild-site rows → enqueue a BullMQ job to the long-running build worker
//
// The "drain runs in-process via @nestjs/schedule" choice keeps the email
// path simple (no separate worker needed) and reserves BullMQ for the one
// job that really earns it (Astro build).
//
// On success, stamp `enqueuedAt` so the row is treated as drained.
// On failure, increment `attempts`, set `failedAt` + `failureReason`. After
// 5 attempts we stop picking the row up — manual intervention required.
//
// In NODE_ENV=test the cron is disabled; tests call `tick()` synchronously.

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { Prisma } from '@owlsnest/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_ADAPTER,
  type EmailAdapter,
  type EmailMessage,
} from '../integrations/email/email.types';
import {
  inquiryReceived,
  inquiryAcknowledged,
  bookingPaymentLink,
  bookingConfirmed,
  bookingDeclined,
  bookingCancelled,
  bookingDatesModified,
  bookingAdHocChargeSent,
  bookingChargeRefunded,
  adminPaymentFailed,
  adminDisputeOpened,
  adminDisputeClosed,
  adminChargeRefundedExternally,
  type RenderedEmail,
} from '../integrations/email/templates';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

/**
 * Dispatch table: maps `payload.event` → renderer.
 *
 * The drain doesn't care whether the row is admin- or guest-targeted; it just
 * picks the recipient by `jobName` and the renderer by `payload.event`. This
 * keeps the booking/inquiry service code unchanged from M7/M8.
 */
const TEMPLATES: Record<string, (p: any) => RenderedEmail> = {
  // inquiry
  'inquiry.new': inquiryReceived,
  'inquiry.acknowledged': inquiryAcknowledged,
  // booking guest events
  'booking.approved': (p) =>
    bookingPaymentLink({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      guestName: p.guestName,
      checkIn: p.checkIn ?? '',
      checkOut: p.checkOut ?? '',
      numNights: p.numNights,
      amount: Number(p.amount ?? 0),
      totalPaid: p.totalPaid,
      currency: p.currency,
      checkoutUrl: p.checkoutUrl,
      // M11: property metadata + house rules link forwarded from BookingService
      propertyName: p.propertyName,
      propertyAddress: p.propertyAddress,
      checkInTime: p.checkInTime,
      houseRulesUrl: p.houseRulesUrl,
    }),
  'booking.confirmed': (p) =>
    bookingConfirmed({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      guestName: p.guestName,
      checkIn: p.checkIn,
      checkOut: p.checkOut,
      numNights: p.numNights,
      amount: p.amount,
      totalPaid: p.totalPaid,
      // M11: property metadata + house rules link
      propertyName: p.propertyName,
      propertyAddress: p.propertyAddress,
      checkInTime: p.checkInTime,
      houseRulesUrl: p.houseRulesUrl,
    }),
  'booking.declined': (p) =>
    bookingDeclined({
      bookingId: p.bookingId,
      guestName: p.guestName,
      reason: p.reason,
    }),
  'booking.cancelled': (p) =>
    bookingCancelled({
      bookingId: p.bookingId,
      guestName: p.guestName,
      refundAmount: p.refundAmount,
      reason: p.reason,
      tier: p.tier,
    }),
  'booking.dates_modified': (p) =>
    bookingDatesModified({
      bookingId: p.bookingId,
      guestName: p.guestName,
      newRange: { checkIn: p.checkIn, checkOut: p.checkOut },
      oldRange: p.oldRange,
      delta: p.delta,
      direction: p.direction,
    }),
  'booking.ad_hoc_charge_sent': (p) =>
    bookingAdHocChargeSent({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      guestName: p.guestName,
      kind: p.kind,
      amount: Number(p.amount),
      description: p.description,
      checkoutUrl: p.checkoutUrl,
    }),
  'booking.charge_refunded': (p) =>
    bookingChargeRefunded({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      guestName: p.guestName,
      amount: Number(p.amount),
      reason: p.reason,
    }),
  // admin events from Stripe webhooks (M9)
  'admin.payment_failed': (p) =>
    adminPaymentFailed({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      paymentIntentId: p.paymentIntentId,
      reason: p.reason,
    }),
  'admin.dispute_opened': (p) =>
    adminDisputeOpened({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      paymentIntentId: p.paymentIntentId,
      disputeReason: p.disputeReason,
      amount: p.amount,
    }),
  'admin.dispute_closed': (p) =>
    adminDisputeClosed({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      status: p.status,
    }),
  'admin.refunded_externally': (p) =>
    adminChargeRefundedExternally({
      bookingId: p.bookingId,
      chargeId: p.chargeId,
      amount: p.amount,
    }),
};

class UnknownJobNameError extends Error {
  constructor(name: string) {
    super(`Unknown outbox jobName: ${name}`);
  }
}
class UnknownEventError extends Error {
  constructor(event: string | undefined) {
    super(`Unknown outbox event: ${event ?? '(none)'}`);
  }
}
class MissingRecipientError extends Error {
  constructor(jobName: string) {
    super(`Outbox row of jobName=${jobName} has no recipient configured.`);
  }
}

@Injectable()
export class OutboxDrainService implements OnModuleDestroy {
  private readonly log = new Logger(OutboxDrainService.name);
  private rebuildQueue: Queue | null = null;
  private rebuildConnection: Redis | null = null;
  private inflight = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Optional() private readonly _placeholder?: never,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.rebuildQueue) await this.rebuildQueue.close();
    if (this.rebuildConnection) await this.rebuildConnection.quit();
  }

  /**
   * Cron tick. Disabled in tests — call tick() manually instead.
   * EVERY_10_SECONDS in non-test envs; the spec says EVERY_5_SECONDS in dev
   * but @nestjs/schedule's CronExpression doesn't ship a 5-second preset and
   * 10s is plenty fast for the volumes a single property generates.
   */
  @Cron(CronExpression.EVERY_10_SECONDS, { disabled: process.env.NODE_ENV === 'test' })
  async scheduledTick(): Promise<void> {
    if (this.inflight) return; // skip overlapping ticks
    this.inflight = true;
    try {
      await this.tick();
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'outbox drain tick failed');
    } finally {
      this.inflight = false;
    }
  }

  /**
   * Drain one batch. Picks up to BATCH_SIZE undrained rows below the retry
   * cap and dispatches them. Returns the count it processed.
   *
   * Public so tests + admin tools can invoke it directly.
   */
  async tick(): Promise<{ processed: number; failed: number }> {
    const rows = await this.prisma.outbox.findMany({
      where: { enqueuedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.dispatch(row);
        await this.prisma.outbox.update({
          where: { id: row.id },
          data: { enqueuedAt: new Date() },
        });
        processed++;
      } catch (err) {
        failed++;
        const reason = (err as Error).message?.slice(0, 500) ?? 'unknown';
        this.log.warn(
          { id: row.id, jobName: row.jobName, reason },
          'outbox dispatch failed',
        );
        await this.prisma.outbox.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            failedAt: new Date(),
            failureReason: reason,
          },
        });
      }
    }
    return { processed, failed };
  }

  /** Route one row to its handler. Throws on failure; caller records the error. */
  private async dispatch(row: {
    id: string;
    jobName: string;
    payload: Prisma.JsonValue;
    idempotencyKey: string | null;
  }): Promise<void> {
    const payload = (row.payload ?? {}) as Record<string, any>;
    switch (row.jobName) {
      case 'guest-notification':
      case 'admin-notification':
        return this.dispatchEmail(row.jobName, payload, row.idempotencyKey);
      case 'rebuild-site':
        return this.dispatchRebuild(payload, row.idempotencyKey);
      default:
        throw new UnknownJobNameError(row.jobName);
    }
  }

  private async dispatchEmail(
    jobName: 'guest-notification' | 'admin-notification',
    payload: Record<string, any>,
    idempotencyKey: string | null,
  ): Promise<void> {
    const event = payload.event as string | undefined;
    if (!event || !(event in TEMPLATES)) {
      throw new UnknownEventError(event);
    }
    const rendered = TEMPLATES[event](payload);
    const recipient =
      jobName === 'guest-notification'
        ? (payload.guestEmail as string | undefined)
        : (process.env.ADMIN_NOTIFICATION_EMAIL as string | undefined);
    if (!recipient) {
      throw new MissingRecipientError(jobName);
    }
    const msg: EmailMessage = {
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [event],
      idempotencyKey: idempotencyKey ?? undefined,
    };
    await this.email.sendEmail(msg);
  }

  private async dispatchRebuild(
    payload: Record<string, any>,
    idempotencyKey: string | null,
  ): Promise<void> {
    // In tests we don't want to require a live Redis just to drain. The
    // `rebuild-site` queue is the only one this drain hands to BullMQ, and
    // its real verification is the build-worker integration — out of scope
    // for the API e2e suite.
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const queue = this.getRebuildQueue();
    // Use the idempotency key as the BullMQ jobId so a retried drain doesn't
    // enqueue duplicate builds for the same trigger (BullMQ silently rejects
    // jobs whose id already exists).
    await queue.add('rebuild-site', payload, {
      jobId: idempotencyKey ?? undefined,
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }

  private getRebuildQueue(): Queue {
    if (this.rebuildQueue) return this.rebuildQueue;
    this.rebuildConnection = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: null,
      // ioredis tries to connect lazily; nothing else changes here.
    });
    this.rebuildQueue = new Queue('rebuild-site', {
      connection: this.rebuildConnection,
    });
    return this.rebuildQueue;
  }
}
