import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './test-app';
import { TestClient, seedTestData, enrollAdmin, signIn } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

describe('Blocked dates (e2e)', () => {
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

  it('GET /api/v1/blocked-dates — rejects unauthenticated', async () => {
    const client = new TestClient(server);
    const res = await client.get('/api/v1/blocked-dates');
    expect(res.status).toBe(401);
  });

  it('full CRUD lifecycle as admin', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    // Empty list
    const empty = await client.get('/api/v1/blocked-dates');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    // Create
    const created = await client.post('/api/v1/blocked-dates', {
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      reason: 'manual_block',
      note: 'Owner stay',
    });
    expect(created.status).toBe(201);
    expect(created.body.startDate).toBe('2026-08-01');
    expect(created.body.endDate).toBe('2026-08-04');
    expect(created.body.reason).toBe('manual_block');
    expect(created.body.sourceSummary).toBe('Owner stay');
    const id = created.body.id;

    // List shows the block
    const list = await client.get('/api/v1/blocked-dates');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    // Audit log written
    const auditCreate = await prisma.auditLogEntry.findFirst({
      where: { action: 'blocked_date.create' },
    });
    expect(auditCreate).toBeTruthy();

    // Delete
    const del = await client.delete(`/api/v1/blocked-dates/${id}`);
    expect(del.status).toBe(200);

    const after = await client.get('/api/v1/blocked-dates');
    expect(after.body).toEqual([]);

    const auditDelete = await prisma.auditLogEntry.findFirst({
      where: { action: 'blocked_date.delete' },
    });
    expect(auditDelete).toBeTruthy();
  });

  it('rejects manual creation of an OTA-imported reason', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    const res = await client.post('/api/v1/blocked-dates', {
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      reason: 'ota_booking',
    });
    expect(res.status).toBe(400);
  });

  it('rejects when endDate <= startDate', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    const res = await client.post('/api/v1/blocked-dates', {
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      reason: 'manual_block',
    });
    expect(res.status).toBe(400);
  });

  it('refuses to delete an OTA-imported block', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);

    // Insert an OTA block directly via Prisma (simulating an iCal import)
    const property = await prisma.property.findFirst();
    const ota = await prisma.blockedDate.create({
      data: {
        propertyId: property!.id,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-03'),
        reason: 'ota_booking',
        sourcePlatform: 'airbnb',
      },
    });

    const res = await client.delete(`/api/v1/blocked-dates/${ota.id}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed UUID on delete', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.delete('/api/v1/blocked-dates/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown UUID on delete', async () => {
    const client = new TestClient(server);
    const creds = await enrollAdmin(prisma);
    await signIn(client, creds);
    const res = await client.delete(
      '/api/v1/blocked-dates/00000000-0000-0000-0000-000000000099',
    );
    expect(res.status).toBe(404);
  });
});
