import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './test-app';
import { TestClient, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Pricing quote (e2e)', () => {
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

  it('GET /api/v1/pricing/quote — happy path returns two-tax breakdown', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-15&checkOut=2026-07-18',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      numberOfNights: 3,
      taxes: {
        stateTlt: { label: 'Oregon Lodging Tax', rate: 0.015 },
        cityTlt: { label: 'Redmond Lodging Tax', rate: 0.09 },
      },
    });
    // Math: nightly 175 + cleaning 75/3 = 200/night → subtotal 600
    expect(res.body.nightlyRate).toBe(200);
    expect(res.body.subtotal).toBe(600);
    expect(res.body.taxes.stateTlt.amount).toBe(9);
    expect(res.body.taxes.cityTlt.amount).toBe(54);
    expect(res.body.taxes.totalTax).toBe(63);
    expect(res.body.total).toBe(663);
  });

  it('rejects checkOut before checkIn', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-18&checkOut=2026-07-15',
    );
    expect(res.status).toBe(400);
  });

  it('rejects checkOut equal to checkIn', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-15&checkOut=2026-07-15',
    );
    expect(res.status).toBe(400);
  });

  it('rejects malformed dates', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=7%2F15%2F2026&checkOut=7%2F18%2F2026',
    );
    expect(res.status).toBe(400);
  });

  it('rejects below the minimum stay (default 2 nights)', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-15&checkOut=2026-07-16',
    );
    expect(res.status).toBe(400);
    expect(res.body?.error?.code ?? res.body?.message).toMatch(/MIN_STAY|min/i);
  });

  it('exempts a 30-night stay from TLT', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-01&checkOut=2026-07-31',
    );
    expect(res.status).toBe(200);
    expect(res.body.numberOfNights).toBe(30);
    expect(res.body.taxes.totalTax).toBe(0);
    expect(res.body.total).toBe(res.body.subtotal);
  });

  it('returns 200 without auth (public endpoint)', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-15&checkOut=2026-07-18',
    );
    expect(res.status).toBe(200);
  });
});
