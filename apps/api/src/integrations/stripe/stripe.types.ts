// Surface area we use from Stripe — typed as a thin interface so we can
// inject a fake in tests without dragging in the full SDK type tree.

export interface StripeCustomer {
  id: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  paymentIntentId: string | null;
}

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  latestChargeId: string | null;
}

export interface StripeBalanceTransaction {
  id: string;
  fee: number; // cents
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface CreateCustomerInput {
  email: string;
  name?: string;
  phone?: string;
}

export interface CreateCheckoutSessionInput {
  customerId: string;
  amountCents: number;
  currency: string;
  description: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeRefund {
  id: string;
  amount: number; // cents
  status: string;
  paymentIntentId: string;
}

export interface CreateRefundInput {
  paymentIntentId: string;
  amountCents: number;
  reason?: string;
  metadata?: Record<string, string>;
}

export const STRIPE_ADAPTER = Symbol('STRIPE_ADAPTER');

export interface StripeAdapter {
  createCustomer(input: CreateCustomerInput): Promise<StripeCustomer>;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<StripeCheckoutSession>;
  retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  retrievePaymentIntent(id: string): Promise<StripePaymentIntent>;
  retrieveBalanceTransaction(id: string): Promise<StripeBalanceTransaction>;
  createRefund(input: CreateRefundInput): Promise<StripeRefund>;
  /**
   * Verify a webhook signature and return the parsed event.
   * Throws if the signature is invalid.
   */
  constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
  ): StripeWebhookEvent;
}
