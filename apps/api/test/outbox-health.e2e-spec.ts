// M11: e2e for GET /api/v1/admin/outbox-health.
// Covers: 401 unauthenticated, 200 admin with empty state, 200 admin with
// 1 dead-lettered + 1 pending row.

import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(45_000);

describe('Outbox health (e2e)', () => {
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

  it('rejects unauthenticated callers with 401', async () => {
    const client = new TestClient(server);
    const res = await client.get('/api/v1/admin/outbox-health');
    expect(res.status).toBe(401);
  });

  it('returns empty state when there is no outbox traffic', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    const res = await client.get('/api/v1/admin/outbox-health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deadLettered: 0,
      pending: 0,
      oldestDeadLetterAt: null,
      recent: [],
    });
  });

  it('returns one dead-lettered + one pending row with the right shape', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    // Seed: one pending (attempts=1, no enqueuedAt) and one dead-lettered
    // (attempts=5, no enqueuedAt). Anything with enqueuedAt set is "drained"
    // and shouldn't show up in either count.
    await prisma.outbox.create({
      data: {
        jobName: 'guest-notification',
        payload: { event: 'inquiry.acknowledged' } as any,
        idempotencyKey: 'pending-1',
        attempts: 1,
      },
    });
    await prisma.outbox.create({
      data: {
        jobName: 'guest-notification',
        payload: { event: 'booking.declined' } as any,
        idempotencyKey: 'dead-1',
        attempts: 5,
        failedAt: new Date('2026-04-25T12:00:00Z'),
        failureReason: 'smtp 550',
      },
    });
    await prisma.outbox.create({
      data: {
        jobName: 'rebuild-site',
        payload: { reason: 'booking.confirmed' } as any,
        idempotencyKey: 'drained-1',
        attempts: 1,
        enqueuedAt: new Date(),
      },
    });

    const res = await client.get('/api/v1/admin/outbox-health');
    expect(res.status).toBe(200);
    expect(res.body.deadLettered).toBe(1);
    expect(res.body.pending).toBe(1);
    expect(res.body.oldestDeadLetterAt).toBe('2026-04-25T12:00:00.000Z');
    expect(res.body.recent).toHaveLength(1);
    expect(res.body.recent[0]).toMatchObject({
      jobName: 'guest-notification',
      idempotencyKey: 'dead-1',
      attempts: 5,
      failureReason: 'smtp 550',
    });
  });
});
