// Test/dev Stripe adapter that doesn't hit the network. Used by the
// e2e suite (so we can simulate webhook events deterministically) and
// available for local dev when no real Stripe keys are present.
//
// Signature verification is intentionally permissive — for tests we
// just JSON.parse the payload. Production must use RealStripeAdapter.

import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
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

interface FakeSession {
  id: string;
  url: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  customerId: string;
  metadata: Record<string, string>;
}

@Injectable()
export class FakeStripeAdapter implements StripeAdapter {
  // Public so tests can inspect what was created.
  readonly customers: StripeCustomer[] = [];
  readonly sessions = new Map<string, FakeSession>();
  readonly paymentIntents = new Map<string, StripePaymentIntent>();
  readonly balanceTransactions = new Map<string, StripeBalanceTransaction>();
  readonly refunds: StripeRefund[] = [];

  // Single-shot test helpers — set by tests to force the next call to throw.
  failNextRefundWith: Error | null = null;
  failNextSessionWith: Error | null = null;

  private id(prefix: string): string {
    return `${prefix}_${randomBytes(8).toString('hex')}`;
  }

  async createCustomer(_input: CreateCustomerInput): Promise<StripeCustomer> {
    const c = { id: this.id('cus_test') };
    this.customers.push(c);
    return c;
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<StripeCheckoutSession> {
    if (this.failNextSessionWith) {
      const err = this.failNextSessionWith;
      this.failNextSessionWith = null;
      throw err;
    }
    const session: FakeSession = {
      id: this.id('cs_test'),
      url: `https://checkout.stripe.test/${this.id('p')}`,
      paymentIntentId: this.id('pi_test'),
      amountCents: input.amountCents,
      currency: input.currency,
      customerId: input.customerId,
      metadata: input.metadata,
    };
    this.sessions.set(session.id, session);
    this.paymentIntents.set(session.paymentIntentId, {
      id: session.paymentIntentId,
      status: 'requires_payment_method',
      amount: input.amountCents,
      currency: input.currency,
      latestChargeId: null,
    });
    return {
      id: session.id,
      url: session.url,
      paymentIntentId: session.paymentIntentId,
    };
  }

  async retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Fake Stripe: session ${id} not found`);
    return { id: s.id, url: s.url, paymentIntentId: s.paymentIntentId };
  }

  async retrievePaymentIntent(id: string): Promise<StripePaymentIntent> {
    const pi = this.paymentIntents.get(id);
    if (!pi) throw new Error(`Fake Stripe: payment_intent ${id} not found`);
    return pi;
  }

  async retrieveBalanceTransaction(
    id: string,
  ): Promise<StripeBalanceTransaction> {
    return this.balanceTransactions.get(id) ?? { id, fee: 0 };
  }

  async createRefund(input: CreateRefundInput): Promise<StripeRefund> {
    if (this.failNextRefundWith) {
      const err = this.failNextRefundWith;
      this.failNextRefundWith = null;
      throw err;
    }
    const refund: StripeRefund = {
      id: this.id('re_test'),
      amount: input.amountCents,
      status: 'succeeded',
      paymentIntentId: input.paymentIntentId,
    };
    this.refunds.push(refund);
    return refund;
  }

  /**
   * Tests build an event object directly and pass it through (signature
   * is the literal string "test"). Production would use the real adapter.
   */
  constructWebhookEvent(
    payload: Buffer | string,
    _signature: string,
  ): StripeWebhookEvent {
    const text = typeof payload === 'string' ? payload : payload.toString('utf-8');
    const parsed = JSON.parse(text) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    if (!parsed.id || !parsed.type || !parsed.data?.object) {
      throw new Error('Fake Stripe: malformed test event');
    }
    return {
      id: parsed.id,
      type: parsed.type,
      data: { object: parsed.data.object },
    };
  }

  // --- Test helpers (not part of the StripeAdapter interface) ---

  /**
   * Simulate a successful payment for a session: bumps the PaymentIntent
   * to 'succeeded' and creates a BalanceTransaction record so subsequent
   * retrieveBalanceTransaction calls return a fee.
   */
  simulatePaymentSucceeded(sessionId: string, feeCents = 50): {
    paymentIntentId: string;
    chargeId: string;
    balanceTransactionId: string;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Fake Stripe: session ${sessionId} not found`);
    const chargeId = this.id('ch_test');
    const btId = this.id('txn_test');
    const pi = this.paymentIntents.get(session.paymentIntentId);
    if (pi) {
      pi.status = 'succeeded';
      pi.latestChargeId = chargeId;
    }
    this.balanceTransactions.set(btId, { id: btId, fee: feeCents });
    return {
      paymentIntentId: session.paymentIntentId,
      chargeId,
      balanceTransactionId: btId,
    };
  }

  /**
   * Build a checkout.session.completed event in the shape Stripe sends.
   */
  buildCheckoutSessionCompletedEvent(sessionId: string): {
    id: string;
    type: 'checkout.session.completed';
    data: { object: Record<string, unknown> };
  } {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Fake Stripe: session ${sessionId} not found`);
    return {
      id: this.id('evt_test'),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: s.id,
          object: 'checkout.session',
          payment_intent: s.paymentIntentId,
          customer: s.customerId,
          amount_total: s.amountCents,
          currency: s.currency,
          metadata: s.metadata,
          payment_status: 'paid',
        },
      },
    };
  }
}
