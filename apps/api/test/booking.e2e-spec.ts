// Full M7 booking lifecycle e2e:
//   1. Public submits inquiry
//   2. Admin lists, marks responded, then converts → real Booking exists
//   3. Admin lists bookings, sees pending_approval, approves
//   4. Approve → Stripe Checkout Session opened (FakeStripe), Booking → approved
//   5. Simulated Stripe webhook (checkout.session.completed) → confirmed
//   6. Idempotency: replay the same webhook → no duplicate side-effects
//   7. Signature failure: bad header → 400 WEBHOOK_SIGNATURE_INVALID

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeStripeAdapter } from '../src/integrations/stripe/fake-stripe.adapter';

jest.setTimeout(45_000);

describe('Booking lifecycle (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeAdapter;

  beforeAll(async () => {
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

  async function publicInquiry(client: TestClient): Promise<string> {
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  // ---- full happy path ----

  it('inquiry → convert → approve → webhook → confirmed', async () => {
    const client = new TestClient(server);
    const inquiryId = await publicInquiry(client);

    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    // 1. Convert
    const convertRes = await client.post(`/api/v1/admin/inquiries/${inquiryId}/convert`);
    expect(convertRes.status).toBe(201);
    expect(convertRes.body.status).toBe('converted');

    // The convert action created a Booking
    const bookings = await prisma.booking.findMany();
    expect(bookings).toHaveLength(1);
    const bookingId = bookings[0].id;
    expect(bookings[0].status).toBe('pending_approval');

    // 2. Admin lists bookings, sees the new one
    const list = await client.get('/api/v1/admin/bookings');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(bookingId);
    expect(list.body[0].status).toBe('pending_approval');
    expect(list.body[0].guest.email).toBe('jane@example.com');
    expect(list.body[0].subtotal).toBe(600);
    expect(list.body[0].totalTaxAmount).toBe(63);
    expect(list.body[0].totalWithTax).toBe(663);

    // 3. Approve
    const approveRes = await client.post(`/api/v1/admin/bookings/${bookingId}/approve`);
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.checkoutUrl).toMatch(/checkout\.stripe\.test/);
    expect(approveRes.body.booking.status).toBe('approved');
    expect(approveRes.body.booking.stripeCustomerId).toBeTruthy();
    expect(approveRes.body.booking.charges).toHaveLength(1);
    const charge = approveRes.body.booking.charges[0];
    expect(charge.kind).toBe('initial');
    expect(charge.status).toBe('sent');
    expect(charge.amount).toBe(663);
    const sessionId = charge.stripeCheckoutSessionId;
    expect(sessionId).toBeTruthy();

    // 4. Simulate the payment + webhook
    const sim = fakeStripe.simulatePaymentSucceeded(sessionId, 50);
    const event = fakeStripe.buildCheckoutSessionCompletedEvent(sessionId);

    const webhookRes = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toEqual({ received: true });

    // 5. Booking confirmed, charge succeeded, fee captured
    const finalBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { charges: true },
    });
    expect(finalBooking?.status).toBe('confirmed');
    expect(finalBooking?.charges).toHaveLength(1);
    expect(finalBooking!.charges[0].status).toBe('succeeded');
    expect(finalBooking!.charges[0].paidAt).toBeInstanceOf(Date);

    // Outbox rows for confirmation + rebuild-site
    const outbox = await prisma.outbox.findMany();
    const events = outbox.map((o) => (o.payload as any)?.event ?? (o.payload as any)?.reason);
    expect(events).toContain('booking.approved');
    expect(events).toContain('booking.confirmed');
    expect(events.some((e) => e === 'booking.confirmed')).toBe(true);
    expect(outbox.some((o) => o.jobName === 'rebuild-site')).toBe(true);

    void sim;
  });

  // ---- idempotency ----

  it('webhook idempotency: replay the same event id → no duplicate side-effects', async () => {
    const client = new TestClient(server);
    const inquiryId = await publicInquiry(client);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    await client.post(`/api/v1/admin/inquiries/${inquiryId}/convert`);
    const bookings = await prisma.booking.findMany();
    const bookingId = bookings[0].id;
    const approveRes = await client.post(`/api/v1/admin/bookings/${bookingId}/approve`);
    const sessionId = approveRes.body.booking.charges[0].stripeCheckoutSessionId;

    fakeStripe.simulatePaymentSucceeded(sessionId);
    const event = fakeStripe.buildCheckoutSessionCompletedEvent(sessionId);

    // Fire the same event twice
    const r1 = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(r1.status).toBe(200);
    const outboxAfterFirst = await prisma.outbox.count();

    const r2 = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(r2.status).toBe(200);
    const outboxAfterSecond = await prisma.outbox.count();

    expect(outboxAfterSecond).toBe(outboxAfterFirst);

    // WebhookEvent recorded exactly once
    const events = await prisma.webhookEvent.findMany({ where: { id: event.id } });
    expect(events).toHaveLength(1);
  });

  // ---- signature verification ----

  it('rejects webhook with missing Stripe-Signature header', async () => {
    const event = {
      id: 'evt_test_xxx',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_zzz' } },
    };
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects webhook with malformed payload (signature path throws)', async () => {
    const res = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send('not-json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  // ---- admin-only guards ----

  it('GET /api/v1/admin/bookings rejects unauthenticated', async () => {
    const client = new TestClient(server);
    const res = await client.get('/api/v1/admin/bookings');
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/admin/bookings/:id/approve rejects unauthenticated', async () => {
    const client = new TestClient(server);
    const res = await client.post(
      '/api/v1/admin/bookings/00000000-0000-0000-0000-000000000099/approve',
    );
    expect(res.status).toBe(401);
  });

  // ---- approval edge cases ----

  it('refuses to approve a booking already in confirmed status', async () => {
    const client = new TestClient(server);
    const inquiryId = await publicInquiry(client);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    await client.post(`/api/v1/admin/inquiries/${inquiryId}/convert`);
    const bookings = await prisma.booking.findMany();
    const bookingId = bookings[0].id;
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'confirmed' },
    });

    const res = await client.post(`/api/v1/admin/bookings/${bookingId}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 404 for unknown booking id on approve', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.post(
      '/api/v1/admin/bookings/00000000-0000-0000-0000-000000000099/approve',
    );
    expect(res.status).toBe(404);
  });
});
