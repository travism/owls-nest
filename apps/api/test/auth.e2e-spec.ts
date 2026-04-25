import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './test-app';
import { TestClient, totp, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

// The auth flow runs many Argon2id operations (intentionally slow);
// each test does setup-and-enroll + multiple login attempts.
jest.setTimeout(30_000);

const EMAIL = 'admin@owlsnest.local';
const PASSWORD = 'correcthorse-battery-staple-99';

describe('Admin Auth (e2e)', () => {
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

  // afterEach — global truncate via test/setup-after-each.ts

  function newClient(): TestClient {
    return new TestClient(server);
  }

  // Tiny helper: full setup + enrollment in one go
  async function setupAndEnroll(client: TestClient): Promise<{ secret: string; recoveryCodes: string[] }> {
    const setupRes = await client.post('/api/v1/auth/admin/setup', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(setupRes.status).toBe(200);
    const secret = new URL(setupRes.body.otpauthUrl).searchParams.get('secret')!;
    const code = await totp(secret);
    const verifyRes = await client.post('/api/v1/auth/admin/setup/verify', {
      setupToken: setupRes.body.setupToken,
      totpCode: code,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.recoveryCodes).toHaveLength(10);
    return { secret, recoveryCodes: verifyRes.body.recoveryCodes };
  }

  it('full setup → login → TOTP → whoami → logout cycle', async () => {
    const client = newClient();
    const { secret } = await setupAndEnroll(client);

    const login = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.challenge).toBe('totp');

    const verify = await client.post('/api/v1/auth/admin/totp', {
      challengeToken: login.body.challengeToken,
      code: await totp(secret),
    });
    expect(verify.status).toBe(200);
    expect(verify.body.user.email).toBe(EMAIL);

    const me = await client.get('/api/v1/auth/admin/whoami');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(EMAIL);

    const logout = await client.post('/api/v1/auth/admin/logout');
    expect(logout.status).toBe(200);

    const me2 = await client.get('/api/v1/auth/admin/whoami');
    expect(me2.status).toBe(401);
  });

  it('rejects /setup if already enrolled', async () => {
    const client = newClient();
    await setupAndEnroll(client);
    const second = await client.post('/api/v1/auth/admin/setup', {
      email: EMAIL,
      password: 'another-password-yes',
    });
    expect(second.status).toBe(409);
  });

  it('rejects login with wrong password', async () => {
    const client = newClient();
    await setupAndEnroll(client);
    const res = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: 'wrong-wrong-wrong',
    });
    expect(res.status).toBe(401);
  });

  it('rejects TOTP step with invalid code', async () => {
    const client = newClient();
    await setupAndEnroll(client);
    const login = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    const verify = await client.post('/api/v1/auth/admin/totp', {
      challengeToken: login.body.challengeToken,
      code: '000000',
    });
    expect(verify.status).toBe(401);
  });

  it('locks the account after 5 wrong passwords', async () => {
    const client = newClient();
    await setupAndEnroll(client);

    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const r = await client.post('/api/v1/auth/admin/login', {
        email: EMAIL,
        password: 'definitely-wrong',
      });
      lastStatus = r.status;
    }
    // After 5 failures the *next* attempt with even the correct password should be 403
    const lockedAttempt = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(lockedAttempt.status).toBe(403);
    expect([401, 403]).toContain(lastStatus); // last wrong attempt either 401 or already 403
  });

  it('recovery code logs in and is single-use', async () => {
    const client = newClient();
    const { recoveryCodes } = await setupAndEnroll(client);
    const recovery = recoveryCodes[0];

    // First login attempt — use recovery code instead of TOTP
    const login1 = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(login1.status).toBe(200);
    const r1 = await client.post('/api/v1/auth/admin/recovery', {
      challengeToken: login1.body.challengeToken,
      code: recovery,
    });
    expect(r1.status).toBe(200);
    expect(r1.body.user.email).toBe(EMAIL);

    // Logout, then attempt to reuse the same recovery code
    await client.post('/api/v1/auth/admin/logout');

    const login2 = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(login2.status).toBe(200);
    const r2 = await client.post('/api/v1/auth/admin/recovery', {
      challengeToken: login2.body.challengeToken,
      code: recovery,
    });
    expect(r2.status).toBe(401);
  });

  it('writes audit log entries for each auth event', async () => {
    const client = newClient();
    const { secret } = await setupAndEnroll(client);

    const login = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    const verify = await client.post('/api/v1/auth/admin/totp', {
      challengeToken: login.body.challengeToken,
      code: await totp(secret),
    });
    expect(verify.status).toBe(200);

    // One failed login for negative coverage
    const bad = await client.post('/api/v1/auth/admin/login', {
      email: EMAIL,
      password: 'wrong',
    });
    expect(bad.status).toBe(401);

    const events = await prisma.auditLogEntry.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('auth.setup.password');
    expect(actions).toContain('auth.setup.totp.enrolled');
    expect(actions).toContain('auth.totp.success');
    expect(actions).toContain('auth.login.success');
    expect(actions).toContain('auth.login.failed');
  });

  it('rejects POST without CSRF token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(server)
      .post('/api/v1/auth/admin/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
