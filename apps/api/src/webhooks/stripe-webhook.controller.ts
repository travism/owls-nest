// Stripe webhook receiver. Public endpoint — security is via signature
// verification using STRIPE_WEBHOOK_SECRET (per arch §13.2).
//
// Idempotency: every event id is recorded in WebhookEvent on first sight;
// a duplicate POST returns 200 immediately without reprocessing.
//
// Lives at /webhooks/stripe (outside /api/v1) so it's exempt from CSRF.
//
// M9 expansion: handle dispute (created/closed), external refund, and payment
// failure events. Each writes an Outbox `admin-notification` row + an
// AuditLogEntry (the audit log captures the inbound event provenance even
// before the outbox is drained — useful for support/dispute defense).

import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Logger } from '@nestjs/common';
import { Prisma } from '@owlsnest/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  STRIPE_ADAPTER,
  type StripeAdapter,
  type StripeWebhookEvent,
} from '../integrations/stripe/stripe.types';
import { BookingService } from '../booking/booking.service';
import { AuditService } from '../auth/audit.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly log = new Logger(StripeWebhookController.name);

  constructor(
    @Inject(STRIPE_ADAPTER) private readonly stripe: StripeAdapter,
    private readonly prisma: PrismaService,
    private readonly bookings: BookingService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Missing Stripe-Signature header.',
      });
    }
    // The raw-body parser in main.ts has populated req.body as a Buffer.
    // If something else stripped that, fall back to JSON.stringify, but
    // signature verification will fail in that case (which is correct).
    const raw = (req as any).rawBody ?? req.body;

    let event: StripeWebhookEvent;
    try {
      event = this.stripe.constructWebhookEvent(raw, signature);
    } catch (err) {
      this.log.warn(
        { err: (err as Error).message },
        'Stripe webhook signature verification failed',
      );
      throw new BadRequestException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid Stripe signature.',
      });
    }

    // Idempotency: insert WebhookEvent row keyed on event.id. If the row
    // already exists (race or replay), bail out without reprocessing.
    try {
      await this.prisma.webhookEvent.create({
        data: {
          id: event.id,
          provider: 'stripe',
          eventType: event.type,
          payload: event as unknown as object,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation on the primary key — exactly
      // what we expect on a duplicate event. Anything else, re-throw.
      if ((err as { code?: string }).code === 'P2002') {
        this.log.log(
          { eventId: event.id },
          'Stripe webhook event already processed, ignoring duplicate',
        );
        return { received: true };
      }
      throw err;
    }

    await this.handle(event);

    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });

    return { received: true };
  }

  private async handle(event: StripeWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as {
          id: string;
          payment_intent?: string | null;
        };
        const result = await this.bookings.handleCheckoutSucceeded({
          sessionId: session.id,
          paymentIntentId: session.payment_intent ?? null,
        });
        if (!result) {
          this.log.warn(
            { sessionId: session.id },
            'Stripe checkout.session.completed for unknown session',
          );
        }
        return;
      }
      case 'charge.dispute.created':
        return this.handleDisputeCreated(event);
      case 'charge.dispute.closed':
        return this.handleDisputeClosed(event);
      case 'charge.refunded':
        return this.handleChargeRefunded(event);
      case 'payment_intent.payment_failed':
        return this.handlePaymentFailed(event);
      default:
        this.log.log(
          { type: event.type, id: event.id },
          'Stripe webhook event type not handled — recorded only',
        );
    }
  }

  // ---------------------------------------------------------------
  // M9 event handlers
  // ---------------------------------------------------------------

  /** Find the matching BookingCharge for a payment_intent id. May be null. */
  private async findChargeByPI(piId: string | null | undefined) {
    if (!piId) return null;
    return this.prisma.bookingCharge.findUnique({
      where: { stripePaymentIntentId: piId },
      include: { booking: { include: { guest: true } } },
    });
  }

  private async handleDisputeCreated(event: StripeWebhookEvent): Promise<void> {
    const dispute = event.data.object as {
      id?: string;
      payment_intent?: string;
      reason?: string;
      amount?: number;
    };
    const charge = await this.findChargeByPI(dispute.payment_intent);
    await this.prisma.outbox.create({
      data: {
        jobName: 'admin-notification',
        payload: {
          event: 'admin.dispute_opened',
          bookingId: charge?.bookingId ?? null,
          chargeId: charge?.id ?? null,
          paymentIntentId: dispute.payment_intent ?? null,
          disputeReason: dispute.reason ?? null,
          amount:
            typeof dispute.amount === 'number' ? dispute.amount / 100 : null,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `admin.dispute_opened:${event.id}`,
      },
    });
    await this.audit.log({
      action: 'webhook.stripe.dispute_created',
      targetType: charge ? 'booking_charge' : 'webhook_event',
      targetId: charge?.id ?? event.id,
      after: {
        eventId: event.id,
        paymentIntentId: dispute.payment_intent,
        reason: dispute.reason,
      },
    });
  }

  private async handleDisputeClosed(event: StripeWebhookEvent): Promise<void> {
    const dispute = event.data.object as {
      id?: string;
      payment_intent?: string;
      status?: string;
    };
    const charge = await this.findChargeByPI(dispute.payment_intent);
    await this.prisma.outbox.create({
      data: {
        jobName: 'admin-notification',
        payload: {
          event: 'admin.dispute_closed',
          bookingId: charge?.bookingId ?? null,
          chargeId: charge?.id ?? null,
          status: dispute.status ?? null,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `admin.dispute_closed:${event.id}`,
      },
    });
    await this.audit.log({
      action: 'webhook.stripe.dispute_closed',
      targetType: charge ? 'booking_charge' : 'webhook_event',
      targetId: charge?.id ?? event.id,
      after: { eventId: event.id, status: dispute.status },
    });
  }

  /**
   * `charge.refunded` fires when a refund is created — including refunds we
   * created via our own admin actions. Detection that the refund originated
   * outside our app is best-effort: if we can find a matching BookingCharge
   * AND the local refundedAmount already accounts for the new total, we
   * treat the event as our own and skip side-effects. Otherwise we update
   * the charge from the event's totals and notify admin.
   */
  private async handleChargeRefunded(event: StripeWebhookEvent): Promise<void> {
    const ch = event.data.object as {
      id?: string;
      payment_intent?: string;
      amount_refunded?: number; // total refunded so far, in cents
      refunded?: boolean; // true if fully refunded
    };
    const charge = await this.findChargeByPI(ch.payment_intent);
    const totalRefundedDollars =
      typeof ch.amount_refunded === 'number' ? ch.amount_refunded / 100 : 0;

    // Skip if local state is already at-or-above the event total (we already
    // applied this via our own admin action; webhook is just confirmation).
    if (
      charge &&
      Number(charge.refundedAmount ?? 0) + 0.001 >= totalRefundedDollars
    ) {
      this.log.log(
        { chargeId: charge.id, eventId: event.id },
        'charge.refunded already reflected locally — skipping side-effects',
      );
      return;
    }

    if (charge) {
      const fully =
        ch.refunded === true ||
        totalRefundedDollars + 0.001 >= Number(charge.amount);
      await this.prisma.bookingCharge.update({
        where: { id: charge.id },
        data: {
          refundedAmount: totalRefundedDollars,
          refundedAt: new Date(),
          ...(fully ? { status: 'refunded' } : {}),
        },
      });
    }

    await this.prisma.outbox.create({
      data: {
        jobName: 'admin-notification',
        payload: {
          event: 'admin.refunded_externally',
          bookingId: charge?.bookingId ?? null,
          chargeId: charge?.id ?? null,
          amount: totalRefundedDollars,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `admin.refunded_externally:${event.id}`,
      },
    });
    await this.audit.log({
      action: 'webhook.stripe.refunded',
      targetType: charge ? 'booking_charge' : 'webhook_event',
      targetId: charge?.id ?? event.id,
      after: {
        eventId: event.id,
        amount: totalRefundedDollars,
      },
    });
  }

  private async handlePaymentFailed(event: StripeWebhookEvent): Promise<void> {
    const pi = event.data.object as {
      id?: string;
      last_payment_error?: { message?: string };
    };
    const charge = await this.findChargeByPI(pi.id);
    await this.prisma.outbox.create({
      data: {
        jobName: 'admin-notification',
        payload: {
          event: 'admin.payment_failed',
          bookingId: charge?.bookingId ?? null,
          chargeId: charge?.id ?? null,
          paymentIntentId: pi.id ?? null,
          reason: pi.last_payment_error?.message ?? null,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `admin.payment_failed:${event.id}`,
      },
    });
    await this.audit.log({
      action: 'webhook.stripe.payment_failed',
      targetType: charge ? 'booking_charge' : 'webhook_event',
      targetId: charge?.id ?? event.id,
      after: {
        eventId: event.id,
        paymentIntentId: pi.id,
        reason: pi.last_payment_error?.message,
      },
    });
  }
}
