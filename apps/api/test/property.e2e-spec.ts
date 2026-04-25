import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

describe('Property (e2e)', () => {
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

  it('GET /api/v1/property — public, returns the seeded property', async () => {
    const client = new TestClient(server);
    const res = await client.get('/api/v1/property');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "The Owl's Nest",
      city: 'Redmond',
      state: 'OR',
      maxGuests: 4,
      baseNightlyRate: 175,
      cleaningFee: 75,
      minStay: 2,
    });
    expect(res.body.cancellationPolicy.tiers).toHaveLength(3);
  });

  it('PATCH /api/v1/property — rejects unauthenticated', async () => {
    const client = new TestClient(server);
    const res = await client.patch('/api/v1/property', { name: 'Hacked' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/v1/property — admin can update fields and audit log captures it', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    const res = await client.patch('/api/v1/property', {
      baseNightlyRate: 200,
      minStay: 3,
    });

    expect(res.status).toBe(200);
    expect(res.body.baseNightlyRate).toBe(200);
    expect(res.body.minStay).toBe(3);

    // Verify DB
    const dbRow = await prisma.property.findFirst();
    expect(Number(dbRow!.baseNightlyRate)).toBe(200);
    expect(dbRow!.minStay).toBe(3);

    // Audit log
    const audit = await prisma.auditLogEntry.findFirst({
      where: { action: 'property.update' },
    });
    expect(audit).toBeTruthy();
    expect(audit!.targetType).toBe('property');
    expect((audit!.before as any).baseNightlyRate).toBe(175);
    expect((audit!.after as any).baseNightlyRate).toBe(200);
  });

  it('PATCH /api/v1/property — empty body is rejected', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.patch('/api/v1/property', {});
    expect(res.status).toBe(400);
  });

  it('PATCH /api/v1/property — invalid field shape is rejected', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.patch('/api/v1/property', { baseNightlyRate: -50 });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/v1/property — can update cancellation policy', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const newPolicy = {
      tiers: [
        { daysBeforeCheckin: 60, refundPercent: 100 },
        { daysBeforeCheckin: 7, refundPercent: 25 },
      ],
    };
    const res = await client.patch('/api/v1/property', {
      cancellationPolicy: newPolicy,
    });
    expect(res.status).toBe(200);
    expect(res.body.cancellationPolicy).toEqual(newPolicy);
  });
});
