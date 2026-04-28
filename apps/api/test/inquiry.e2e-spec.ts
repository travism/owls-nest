import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

describe('Inquiry (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await seedTestData(prisma);
  });

  // ---- Public submission ----

  it('POST /api/v1/inquiries — works without CSRF (public endpoint, no session)', async () => {
    // Bare supertest call — no cookies, no CSRF header. This is the call
    // shape the public Astro form makes when an anonymous guest submits.
    const res = await request(server)
      .post('/api/v1/inquiries')
      .send({
        name: 'Anon',
        email: 'anon@example.com',
        phone: '+1 555 0101',
        checkIn: '2026-07-15',
        checkOut: '2026-07-18',
        numGuests: 2,
      });
    expect(res.status).toBe(201);
  });

  it('POST /api/v1/inquiries — happy path returns id + status', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
      message: 'Heading to Smith Rock!',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'new' });
    expect(typeof res.body.id).toBe('string');

    // Inquiry persisted
    const dbRow = await prisma.inquiry.findUnique({ where: { id: res.body.id } });
    expect(dbRow).toBeTruthy();
    expect(dbRow!.email).toBe('jane@example.com');

    // Outbox row written for admin notification
    const outbox = await prisma.outbox.findFirst({
      where: { jobName: 'admin-notification' },
    });
    expect(outbox).toBeTruthy();
    expect((outbox!.payload as any).event).toBe('inquiry.new');
    expect(outbox!.idempotencyKey).toBe(`inquiry.new:${res.body.id}`);
  });

  it('POST /api/v1/inquiries — accepts inquiry without optional fields', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: 'Quick Asker',
      email: 'quick@example.com',
      phone: '+1 555 0102',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    expect(res.status).toBe(201);
  });

  it('rejects missing phone', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane',
      email: 'jane@example.com',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects invalid email', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane',
      email: 'not-an-email',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects checkOut <= checkIn', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane',
      email: 'jane@example.com',
      checkIn: '2026-07-18',
      checkOut: '2026-07-15',
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const client = new TestClient(server);
    const res = await client.post('/api/v1/inquiries', {
      name: '',
      email: 'jane@example.com',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    expect(res.status).toBe(400);
  });

  // ---- Admin list / detail / transitions ----

  it('admin endpoints reject unauthenticated', async () => {
    const client = new TestClient(server);
    expect((await client.get('/api/v1/admin/inquiries')).status).toBe(401);
    expect((await client.post('/api/v1/admin/inquiries/00000000-0000-0000-0000-000000000099/transition', { status: 'closed' })).status).toBe(401);
  });

  async function createPublicInquiry(client: TestClient, overrides: Record<string, unknown> = {}) {
    const res = await client.post('/api/v1/inquiries', {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('full admin lifecycle: list → detail → transition → convert', async () => {
    const client = new TestClient(server);
    const id = await createPublicInquiry(client);

    // Authenticate as admin (re-uses the same TestClient cookie jar)
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    const list = await client.get('/api/v1/admin/inquiries');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    const filtered = await client.get('/api/v1/admin/inquiries?status=new');
    expect(filtered.body).toHaveLength(1);

    const filteredEmpty = await client.get('/api/v1/admin/inquiries?status=closed');
    expect(filteredEmpty.body).toHaveLength(0);

    const detail = await client.get(`/api/v1/admin/inquiries/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.email).toBe('jane@example.com');

    const responded = await client.post(`/api/v1/admin/inquiries/${id}/transition`, {
      status: 'responded',
    });
    expect(responded.status).toBe(201);
    expect(responded.body.status).toBe('responded');

    const converted = await client.post(`/api/v1/admin/inquiries/${id}/convert`);
    expect(converted.status).toBe(201);
    expect(converted.body.status).toBe('converted');

    // Audit log captured both
    const audits = await prisma.auditLogEntry.findMany({
      where: { targetType: 'inquiry', targetId: id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('inquiry.transition');
    expect(actions).toContain('inquiry.convert');
  });

  it('rejects illegal transition (closed → responded)', async () => {
    const client = new TestClient(server);
    const id = await createPublicInquiry(client);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    await client.post(`/api/v1/admin/inquiries/${id}/transition`, { status: 'closed' });
    const bad = await client.post(`/api/v1/admin/inquiries/${id}/transition`, {
      status: 'responded',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects double-convert with CONFLICT', async () => {
    const client = new TestClient(server);
    const id = await createPublicInquiry(client);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    await client.post(`/api/v1/admin/inquiries/${id}/convert`);
    const second = await client.post(`/api/v1/admin/inquiries/${id}/convert`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects converting a closed inquiry', async () => {
    const client = new TestClient(server);
    const id = await createPublicInquiry(client);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    await client.post(`/api/v1/admin/inquiries/${id}/transition`, { status: 'closed' });
    const res = await client.post(`/api/v1/admin/inquiries/${id}/convert`);
    expect(res.status).toBe(400);
  });

  it('detail endpoint returns 404 for unknown id', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.get('/api/v1/admin/inquiries/00000000-0000-0000-0000-000000000099');
    expect(res.status).toBe(404);
  });

  it('detail endpoint returns 400 for non-UUID id', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.get('/api/v1/admin/inquiries/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
