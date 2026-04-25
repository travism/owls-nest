// E2E: every error from the API uses the same envelope shape.
//   { error: { code, message, details? } }
//
// Covers the four major sources of errors:
//   1. Domain code throwing structured payloads
//   2. Bare HttpException (e.g. UnauthorizedException) from a guard
//   3. csrf-csrf middleware throwing ForbiddenException with bare message
//   4. Validation errors with details

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { TestClient, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

describe('API error envelope (e2e)', () => {
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

  it('401 from AdminSessionGuard uses standard envelope', async () => {
    const client = new TestClient(server);
    // GET /api/v1/blocked-dates is admin-only; without a session we get a 401.
    const res = await client.get('/api/v1/blocked-dates');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(typeof res.body.error.message).toBe('string');
  });

  it('403 from csrf-csrf is normalized to CSRF_INVALID with envelope', async () => {
    // Send a POST without an x-csrf-token header at all.
    const res = await request(server)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'x@y.z', password: 'whatever' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { code: 'CSRF_INVALID' },
    });
    expect(typeof res.body.error.message).toBe('string');
  });

  it('400 from Zod validation includes details', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=not-a-date&checkOut=2026-07-18',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toBeDefined();
  });

  it('400 from MIN_STAY_VIOLATION uses domain code (not generic BAD_REQUEST)', async () => {
    const client = new TestClient(server);
    const res = await client.get(
      '/api/v1/pricing/quote?checkIn=2026-07-15&checkOut=2026-07-16', // 1 night, min stay 2
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MIN_STAY_VIOLATION');
    expect(res.body.error.details).toMatchObject({ required: 2, requested: 1 });
  });

  it('404 NotFoundException uses NOT_FOUND code', async () => {
    // Wipe the property to trigger NOT_FOUND on /api/v1/property
    await prisma.taxJurisdiction.deleteMany();
    await prisma.property.deleteMany();
    const client = new TestClient(server);
    const res = await client.get('/api/v1/property');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
