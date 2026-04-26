// Helpers for writing concise e2e tests.

import { generate } from 'otplib';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { TotpService } from '../src/auth/totp.service';

/**
 * Stateful client that keeps cookies + CSRF token across requests,
 * with auto-retry on CSRF rotation (matches the SPA's behavior).
 */
export class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken: string | null = null;

  constructor(private readonly server: any) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(setCookie: string | string[] | undefined) {
    if (!setCookie) return;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of list) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  async primeCsrf(): Promise<string> {
    const res = await request(this.server)
      .get('/api/v1/auth/csrf-token')
      .set('Cookie', this.cookieHeader());
    this.absorb(res.headers['set-cookie']);
    this.csrfToken = (res.body as { token: string }).token;
    return this.csrfToken;
  }

  async get(path: string) {
    const res = await request(this.server).get(path).set('Cookie', this.cookieHeader());
    this.absorb(res.headers['set-cookie']);
    return res;
  }

  async post(path: string, body?: object) {
    return this.mutate('post', path, body);
  }

  async patch(path: string, body?: object) {
    return this.mutate('patch', path, body);
  }

  async delete(path: string) {
    return this.mutate('delete', path);
  }

  private async mutate(
    method: 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
    retried = false,
  ): Promise<request.Response> {
    if (!this.csrfToken) await this.primeCsrf();
    const req = request(this.server)
      [method](path)
      .set('Cookie', this.cookieHeader())
      .set('x-csrf-token', this.csrfToken!)
      .set('Content-Type', 'application/json');
    const res = body ? await req.send(body) : await req.send();
    this.absorb(res.headers['set-cookie']);
    if (!retried && res.status === 403) {
      // ApiExceptionFilter normalizes csrf-csrf rejections to CSRF_INVALID
      const code = (res.body as any)?.error?.code;
      if (code === 'CSRF_INVALID') {
        await this.primeCsrf();
        return this.mutate(method, path, body, true);
      }
    }
    return res;
  }
}

/**
 * Generate a TOTP code for a given base32 secret. Used in tests to
 * stand in for the user typing a code from their authenticator app.
 */
export async function totp(secret: string): Promise<string> {
  return generate({ secret });
}

// Tables to truncate between tests. Keep in sync with schema.prisma.
const TABLES = [
  'audit_log_entry',
  'webhook_event',
  'outbox',
  'magic_link_token',
  'cleaner_request_token',
  'cleaner_token',
  'turnover_assignment',
  'booking_charge',
  'message',
  'message_template',
  'review',
  'blog_post',
  'blocked_date',
  'pricing_override',
  'pricing_cache_entry',
  'calendar_sync',
  'inquiry',
  'booking',
  'guest',
  'cleaner',
  'admin_user',
  'tax_jurisdiction',
  'property',
  'promo_code',
];

/**
 * Wipe all data from the test database. Call this from beforeEach
 * to ensure tests are isolated.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Insert the seeded property + tax jurisdictions + an admin user with
 * the placeholder password (so /setup is the next valid call). Truncates
 * first so it can be called repeatedly.
 */
export async function seedTestData(prisma: PrismaService): Promise<void> {
  await truncateAll(prisma);
  const property = await prisma.property.create({
    data: {
      id: '00000000-0000-0000-0000-000000000001',
      name: "The Owl's Nest",
      addressLine1: '147 SW 4th St',
      city: 'Redmond',
      state: 'OR',
      postalCode: '97756',
      checkInTime: '15:00:00',
      checkOutTime: '11:00:00',
      maxGuests: 4,
      baseNightlyRate: 175,
      cleaningFee: 75,
      minStay: 2,
      cancellationPolicy: {
        tiers: [
          { daysBeforeCheckin: 30, refundPercent: 100 },
          { daysBeforeCheckin: 14, refundPercent: 50 },
          { daysBeforeCheckin: 0, refundPercent: 0 },
        ],
      },
    },
  });

  await prisma.taxJurisdiction.createMany({
    data: [
      {
        propertyId: property.id,
        jurisdictionName: 'Oregon State TLT',
        jurisdictionLevel: 'state',
        taxRate: 0.015,
        adminFeeRate: 0.05,
        filingFrequency: 'quarterly',
      },
      {
        propertyId: property.id,
        jurisdictionName: 'City of Redmond TLT',
        jurisdictionLevel: 'city',
        taxRate: 0.09,
        filingFrequency: 'monthly',
      },
    ],
  });

  await prisma.adminUser.create({
    data: {
      email: 'admin@owlsnest.local',
      passwordHash: 'PLACEHOLDER-MUST-RESET',
    },
  });
}

export async function getApp(app: INestApplication) {
  return app.getHttpServer();
}

/**
 * Pre-enroll an admin user with known credentials so e2e tests can sign in
 * with one call. Sets password + TOTP secret directly in the DB, mimicking
 * a user who has already completed the setup flow.
 *
 * Returns the credentials needed to sign in.
 */
export async function enrollAdmin(
  prisma: PrismaService,
  password = 'test-admin-password-99',
  email = 'admin@owlsnest.local',
): Promise<{ email: string; password: string; totpSecret: string }> {
  const passwords = new PasswordService();
  const totpService = new TotpService();
  const passwordHash = await passwords.hash(password);
  const totpSecret = totpService.generateSecret();
  const totpEncrypted = totpService.encrypt(totpSecret);

  await prisma.adminUser.update({
    where: { email },
    data: {
      passwordHash,
      totpSecretEncrypted: totpEncrypted,
      totpEnrolledAt: new Date(),
      recoveryCodesHashed: [],
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  return { email, password, totpSecret };
}

/**
 * Drives a TestClient through the full login flow.
 */
export async function signIn(
  client: TestClient,
  creds: { email: string; password: string; totpSecret: string },
): Promise<void> {
  const login = await client.post('/api/v1/auth/admin/login', {
    email: creds.email,
    password: creds.password,
  });
  if (login.status !== 200) {
    throw new Error(`signIn login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  const code = await totp(creds.totpSecret);
  const verify = await client.post('/api/v1/auth/admin/totp', {
    challengeToken: login.body.challengeToken,
    code,
  });
  if (verify.status !== 200) {
    throw new Error(`signIn totp failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
}
