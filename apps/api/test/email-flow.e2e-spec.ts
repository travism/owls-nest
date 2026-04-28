// E2E: outbox → email-flow drain.
//
// Exercises the M9 wiring end-to-end:
//   - Public submits an inquiry → outbox rows for admin + guest
//   - Drain tick → FakeEmailAdapter records both sends
//   - Approve booking → drain → guest receives payment-link email
//   - Webhook checkout.session.completed → drain → guest receives confirmation
//
// All emails route through the FakeEmailAdapter (NODE_ENV=test forces it via
// the EmailModule resolver).

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeStripeAdapter } from '../src/integrations/stripe/fake-stripe.adapter';
import { FakeEmailAdapter } from '../src/integrations/email/fake-email.adapter';
import { OutboxDrainService } from '../src/outbox/outbox-drain.service';

jest.setTimeout(45_000);

describe('Email flow via outbox drain (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let fakeEmail: FakeEmailAdapter;
  let fakeStripe: FakeStripeAdapter;
  let drain: OutboxDrainService;

  beforeAll(async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@owlsnest.local';
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    fakeEmail = app.get(FakeEmailAdapter);
    fakeStripe = app.get(FakeStripeAdapter);
    drain = app.get(OutboxDrainService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await seedTestData(prisma);
    fakeEmail.reset();
  });

  it('inquiry submit → drain → admin + guest emails sent', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
      message: 'Pet friendly?',
    });
    expect(res.status).toBe(201);

    const result = await drain.tick();
    expect(result.failed).toBe(0);
    expect(result.processed).toBe(2);

    expect(fakeEmail.sent).toHaveLength(2);
    const recipients = fakeEmail.sent.map((m) => m.to).sort();
    expect(recipients).toEqual(['admin@owlsnest.local', 'jane@example.com']);
    const adminEmail = fakeEmail.sent.find((m) => m.to === 'admin@owlsnest.local');
    expect(adminEmail!.subject).toMatch(/inquiry/i);
    expect(adminEmail!.html).toContain('Jane Smith');
    const guestEmail = fakeEmail.sent.find((m) => m.to === 'jane@example.com');
    expect(guestEmail!.subject).toMatch(/received/i);
  });

  it('booking approve → drain → guest gets payment-link email', async () => {
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
    const approveRes = await client.post(
      `/api/v1/admin/bookings/${bookings[0].id}/approve`,
    );
    expect(approveRes.status).toBe(201);

    fakeEmail.reset();
    await drain.tick();

    const guestSends = fakeEmail.sent.filter((m) => m.to === 'jane@example.com');
    const paymentEmail = guestSends.find((m) =>
      /complete (payment|your reservation)/i.test(m.subject),
    );
    expect(paymentEmail).toBeTruthy();
    expect(paymentEmail!.html).toContain('checkout.stripe.test');
  });

  it('checkout.session.completed → drain → guest gets confirmation email', async () => {
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
    const approveRes = await client.post(
      `/api/v1/admin/bookings/${bookings[0].id}/approve`,
    );
    const sessionId = approveRes.body.booking.charges[0].stripeCheckoutSessionId;
    fakeStripe.simulatePaymentSucceeded(sessionId);
    const event = fakeStripe.buildCheckoutSessionCompletedEvent(sessionId);
    const wh = await request(server)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(wh.status).toBe(200);

    fakeEmail.reset();
    await drain.tick();

    const confirm = fakeEmail.sent.find((m) =>
      /confirmed/i.test(m.subject) && m.to === 'jane@example.com',
    );
    expect(confirm).toBeTruthy();
  });

  it('successfully drained rows are not re-sent on a second tick', async () => {
    const client = new TestClient(server);
    await client.post('/api/v1/inquiries', {
      name: 'Jane',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    const r1 = await drain.tick();
    expect(r1.processed).toBe(2);
    fakeEmail.reset();
    const r2 = await drain.tick();
    expect(r2.processed).toBe(0);
    expect(fakeEmail.sent).toHaveLength(0);
  });
});
