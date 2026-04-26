// Stripe webhook receiver. Public endpoint — security is via signature
// verification using STRIPE_WEBHOOK_SECRET (per arch §13.2).
//
// Idempotency: every event id is recorded in WebhookEvent on first sight;
// a duplicate POST returns 200 immediately without reprocessing.
//
// Lives at /webhooks/stripe (outside /api/v1) so it's exempt from CSRF.

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
import { PrismaService } from '../prisma/prisma.service';
import {
  STRIPE_ADAPTER,
  type StripeAdapter,
  type StripeWebhookEvent,
} from '../integrations/stripe/stripe.types';
import { BookingService } from '../booking/booking.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly log = new Logger(StripeWebhookController.name);

  constructor(
    @Inject(STRIPE_ADAPTER) private readonly stripe: StripeAdapter,
    private readonly prisma: PrismaService,
    private readonly bookings: BookingService,
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
      // Future: charge.refunded (M8), charge.dispute.created (M8), etc.
      default:
        this.log.log(
          { type: event.type, id: event.id },
          'Stripe webhook event type not handled — recorded only',
        );
    }
  }
}
