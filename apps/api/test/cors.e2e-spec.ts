// Locks in the CORS allowlist so a later change can't accidentally
// drop the public web origin (http://localhost:4321) and break the
// guest site's calls to /api/v1/property + /api/v1/availability.

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';

describe('CORS (e2e)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['http://localhost:4321', 'public web'],
    ['http://localhost:5173', 'admin SPA'],
  ])('allows the %s origin (%s)', async (origin) => {
    const res = await request(server)
      .get('/api/v1/property')
      .set('Origin', origin);
    // We don't care about the body here — just the CORS header
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not echo unknown origins', async () => {
    const res = await request(server)
      .get('/api/v1/property')
      .set('Origin', 'http://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight OPTIONS for the public web origin succeeds', async () => {
    const res = await request(server)
      .options('/api/v1/availability')
      .set('Origin', 'http://localhost:4321')
      .set('Access-Control-Request-Method', 'GET');
    // Either 204 (typical) or 200 — both are acceptable per spec
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4321');
  });
});
