// E2E for the M9 Stripe webhook event additions.
// Each new event:
//   - charge.dispute.created     → admin-notification outbox + audit
//   - charge.dispute.closed      → admin-notification outbox + audit
//   - charge.refunded            → updates BookingCharge + outbox + audit
//   - payment_intent.payment_failed → outbox + audit (no booking mutation)
//
// Idempotency comes from the existing WebhookEvent table — we don't re-test
// it here (covered in booking.e2e-spec.ts).

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeStripeAdapter } from '../src/integrations/stripe/fake-stripe.adapter';

jest.setTimeout(45_000);

describe('Stripe webhook M9 events (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeAdapter;

  beforeAll(async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@owlsnest.local';
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    fakeStripe = app.get(FakeStripeAdapter);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await seedTestData(prisma);
  });

  async function setupConfirmedBooking() {
    const client = new TestClient(server);
    await client.post('/api/v1/inquiries', {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const inquiries = await prisma.inquiry.findMany();
    await client.post(`/api/v1/admin/inquiries/${inquiries[0].id}/convert`);
    const bookings = await prisma.booking.findMany();
    const approve = await client.post(
      `/api/v1/admin/bookings/${bookings[0].id}/approve`,
    );
    const sessionId = approve.body.booking.charges[0].stripeCheckoutSessionId;
    const sim = fakeStripe.simulatePaymentSucceeded(sessionId);
    const event = fakeStripe.buildCheckoutSessionCompletedEvent(sessionId);
    await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    return {
      bookingId: bookings[0].id,
      chargeId: approve.body.booking.charges[0].id,
      paymentIntentId: sim.paymentIntentId,
    };
  }

  it('charge.dispute.created → admin-notification outbox + audit row', async () => {
    const { paymentIntentId, chargeId, bookingId } = await setupConfirmedBooking();
    const event = fakeStripe.buildDisputeCreatedEvent(paymentIntentId, 'fraudulent');
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);

    const outbox = await prisma.outbox.findMany({
      where: { jobName: 'admin-notification' },
    });
    const dispute = outbox.find(
      (o) => (o.payload as any).event === 'admin.dispute_opened',
    );
    expect(dispute).toBeTruthy();
    expect((dispute!.payload as any).disputeReason).toBe('fraudulent');
    expect((dispute!.payload as any).chargeId).toBe(chargeId);
    expect((dispute!.payload as any).bookingId).toBe(bookingId);

    const audit = await prisma.auditLogEntry.findMany({
      where: { action: 'webhook.stripe.dispute_created' },
    });
    expect(audit).toHaveLength(1);
  });

  it('charge.dispute.closed → admin outbox + audit', async () => {
    const { paymentIntentId } = await setupConfirmedBooking();
    const event = fakeStripe.buildDisputeClosedEvent(paymentIntentId, 'won');
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);

    const outbox = await prisma.outbox.findMany({
      where: { jobName: 'admin-notification' },
    });
    const closed = outbox.find(
      (o) => (o.payload as any).event === 'admin.dispute_closed',
    );
    expect(closed).toBeTruthy();
    expect((closed!.payload as any).status).toBe('won');

    const audit = await prisma.auditLogEntry.findMany({
      where: { action: 'webhook.stripe.dispute_closed' },
    });
    expect(audit).toHaveLength(1);
  });

  it('charge.refunded (external) → updates charge + outbox + audit', async () => {
    const { paymentIntentId, chargeId } = await setupConfirmedBooking();
    // Refund of the full $663 originated outside our app.
    const event = fakeStripe.buildChargeRefundedEvent(paymentIntentId, 66300, true);
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);

    const charge = await prisma.bookingCharge.findUnique({
      where: { id: chargeId },
    });
    expect(charge?.status).toBe('refunded');
    expect(Number(charge?.refundedAmount)).toBeCloseTo(663);

    const outbox = await prisma.outbox.findMany({
      where: { jobName: 'admin-notification' },
    });
    const ext = outbox.find(
      (o) => (o.payload as any).event === 'admin.refunded_externally',
    );
    expect(ext).toBeTruthy();
    expect((ext!.payload as any).amount).toBe(663);

    const audit = await prisma.auditLogEntry.findMany({
      where: { action: 'webhook.stripe.refunded' },
    });
    expect(audit).toHaveLength(1);
  });

  it('charge.refunded for an already-locally-refunded charge skips side-effects', async () => {
    // Trigger our own admin refund first; the resulting Stripe webhook would
    // arrive next and should be a no-op.
    const { paymentIntentId, chargeId } = await setupConfirmedBooking();
    await prisma.bookingCharge.update({
      where: { id: chargeId },
      data: { refundedAmount: 663, status: 'refunded' },
    });
    const event = fakeStripe.buildChargeRefundedEvent(paymentIntentId, 66300, true);
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);

    // No new outbox row written for the already-applied refund
    const outbox = await prisma.outbox.findMany({
      where: { jobName: 'admin-notification' },
    });
    const ext = outbox.find(
      (o) => (o.payload as any).event === 'admin.refunded_externally',
    );
    expect(ext).toBeUndefined();
  });

  it('payment_intent.payment_failed → outbox + audit, no booking mutation', async () => {
    const { paymentIntentId, bookingId } = await setupConfirmedBooking();
    const event = fakeStripe.buildPaymentFailedEvent(paymentIntentId, 'card_declined');
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);

    const outbox = await prisma.outbox.findMany({
      where: { jobName: 'admin-notification' },
    });
    const failed = outbox.find(
      (o) => (o.payload as any).event === 'admin.payment_failed',
    );
    expect(failed).toBeTruthy();
    expect((failed!.payload as any).reason).toBe('card_declined');

    const audit = await prisma.auditLogEntry.findMany({
      where: { action: 'webhook.stripe.payment_failed' },
    });
    expect(audit).toHaveLength(1);

    // Booking unchanged — admin handles, system doesn't auto-mutate state.
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe('confirmed');
  });
});
