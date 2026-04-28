// Real Stripe adapter. Wraps the official SDK so the rest of the app can
// stay decoupled from it. Test code uses FakeStripeAdapter instead.
//
// If STRIPE_SECRET_KEY isn't set, this adapter still constructs but every
// network call throws — keeps the dev server bootable without Stripe creds
// while making it obvious when something tries to use it.

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import type {
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  CreateRefundInput,
  StripeAdapter,
  StripeBalanceTransaction,
  StripeCheckoutSession,
  StripeCustomer,
  StripePaymentIntent,
  StripeRefund,
  StripeWebhookEvent,
} from './stripe.types';

@Injectable()
export class RealStripeAdapter implements StripeAdapter {
  private readonly log = new Logger(RealStripeAdapter.name);
  private readonly client: InstanceType<typeof Stripe> | null;
  private readonly webhookSecret: string | undefined;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (key) {
      // Use the SDK's bundled API version — passing a literal locks us to a
      // specific date string the types accept; using undefined tells Stripe
      // to use the account default which matches the SDK build.
      this.client = new Stripe(key);
    } else {
      this.client = null;
      this.log.warn('STRIPE_SECRET_KEY not set — Stripe calls will throw.');
    }
  }

  private mustClient(): InstanceType<typeof Stripe> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'INTERNAL_ERROR',
        message: 'Stripe is not configured.',
      });
    }
    return this.client;
  }

  async createCustomer(input: CreateCustomerInput): Promise<StripeCustomer> {
    const c = await this.mustClient().customers.create({
      email: input.email,
      name: input.name,
      phone: input.phone,
    });
    return { id: c.id };
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<StripeCheckoutSession> {
    const s = await this.mustClient().checkout.sessions.create({
      mode: 'payment',
      customer: input.customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: input.currency,
            unit_amount: input.amountCents,
            product_data: { name: input.description },
          },
          quantity: 1,
        },
      ],
      metadata: input.metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    return {
      id: s.id,
      url: s.url ?? '',
      paymentIntentId:
        typeof s.payment_intent === 'string' ? s.payment_intent : null,
    };
  }

  async retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    const s = await this.mustClient().checkout.sessions.retrieve(id);
    return {
      id: s.id,
      url: s.url ?? '',
      paymentIntentId:
        typeof s.payment_intent === 'string' ? s.payment_intent : null,
    };
  }

  async retrievePaymentIntent(id: string): Promise<StripePaymentIntent> {
    const pi = await this.mustClient().paymentIntents.retrieve(id);
    return {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      latestChargeId:
        typeof pi.latest_charge === 'string' ? pi.latest_charge : null,
    };
  }

  async retrieveBalanceTransaction(id: string): Promise<StripeBalanceTransaction> {
    const bt = await this.mustClient().balanceTransactions.retrieve(id);
    return { id: bt.id, fee: bt.fee };
  }

  async createRefund(input: CreateRefundInput): Promise<StripeRefund> {
    const r = await this.mustClient().refunds.create({
      payment_intent: input.paymentIntentId,
      amount: input.amountCents,
      reason: input.reason as
        | 'duplicate'
        | 'fraudulent'
        | 'requested_by_customer'
        | undefined,
      metadata: input.metadata,
    });
    return {
      id: r.id,
      amount: r.amount,
      status: r.status ?? 'unknown',
      paymentIntentId:
        typeof r.payment_intent === 'string'
          ? r.payment_intent
          : input.paymentIntentId,
    };
  }

  constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
  ): StripeWebhookEvent {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException({
        code: 'INTERNAL_ERROR',
        message: 'Stripe webhook secret not configured.',
      });
    }
    const ev = this.mustClient().webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret,
    );
    return {
      id: ev.id,
      type: ev.type,
      data: { object: ev.data.object as unknown as Record<string, unknown> },
    };
  }
}
