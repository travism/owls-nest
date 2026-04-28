// OutboxDrainService unit tests. Mocks Prisma + email adapter at the boundary
// so we exercise the dispatch table + retry/backoff logic in isolation.
//
// The rebuild-site path is covered indirectly: we don't construct a real
// BullMQ queue here (it would require Redis); instead we test that the
// drain stamps enqueuedAt on success and increments attempts on failure.

import { OutboxDrainService } from './outbox-drain.service';

interface OutboxRow {
  id: string;
  jobName: string;
  payload: any;
  idempotencyKey: string | null;
  enqueuedAt: Date | null;
  attempts: number;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}

function makeRow(partial: Partial<OutboxRow>): OutboxRow {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    jobName: partial.jobName ?? 'guest-notification',
    payload: partial.payload ?? {},
    idempotencyKey: partial.idempotencyKey ?? null,
    enqueuedAt: partial.enqueuedAt ?? null,
    attempts: partial.attempts ?? 0,
    failedAt: partial.failedAt ?? null,
    failureReason: partial.failureReason ?? null,
    createdAt: partial.createdAt ?? new Date(),
  };
}

function buildPrisma(rows: OutboxRow[]) {
  return {
    rows,
    outbox: {
      findMany: jest.fn(async ({ where }: any) => {
        return rows
          .filter(
            (r) =>
              r.enqueuedAt === null &&
              r.attempts < (where?.attempts?.lt ?? Infinity),
          )
          .slice(0, 25);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        if (data.enqueuedAt) row.enqueuedAt = data.enqueuedAt;
        if (data.failedAt) row.failedAt = data.failedAt;
        if (data.failureReason !== undefined) row.failureReason = data.failureReason;
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        return row;
      }),
    },
  };
}

function buildFakeEmail() {
  const sent: any[] = [];
  let failNext: Error | null = null;
  return {
    sent,
    setFailNext(err: Error) {
      failNext = err;
    },
    sendEmail: jest.fn(async (msg: any) => {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      sent.push(msg);
      return { id: 'fake_id', provider: 'fake' as const };
    }),
  };
}

function buildSvc(prisma: any, email: any): OutboxDrainService {
  // Bypass the constructor's @Inject — we just hand it both deps directly.
  return new OutboxDrainService(prisma, email);
}

describe('OutboxDrainService', () => {
  const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL;
  beforeAll(() => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@owlsnest.local';
  });
  afterAll(() => {
    if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
    else process.env.ADMIN_NOTIFICATION_EMAIL = ORIGINAL_ADMIN_EMAIL;
  });

  it('drains a guest-notification row → email sent + enqueuedAt stamped', async () => {
    const rows = [
      makeRow({
        id: 'r1',
        jobName: 'guest-notification',
        payload: {
          event: 'inquiry.acknowledged',
          inquiryId: 'i1',
          guestName: 'Jane',
          guestEmail: 'jane@example.com',
          checkIn: '2026-07-15',
          checkOut: '2026-07-18',
        },
      }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    const svc = buildSvc(prisma, email);
    const result = await svc.tick();
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe('jane@example.com');
    expect(rows[0].enqueuedAt).toBeInstanceOf(Date);
  });

  it('drains an admin-notification row → email goes to ADMIN_NOTIFICATION_EMAIL', async () => {
    const rows = [
      makeRow({
        jobName: 'admin-notification',
        payload: {
          event: 'inquiry.new',
          inquiryId: 'i1',
          guestName: 'Jane',
          checkIn: '2026-07-15',
          checkOut: '2026-07-18',
        },
      }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    const svc = buildSvc(prisma, email);
    await svc.tick();
    expect(email.sent[0].to).toBe('admin@owlsnest.local');
  });

  it('failure → increments attempts + records failureReason', async () => {
    const rows = [
      makeRow({
        jobName: 'guest-notification',
        payload: {
          event: 'inquiry.acknowledged',
          guestEmail: 'jane@example.com',
          guestName: 'Jane',
          checkIn: '2026-07-15',
          checkOut: '2026-07-18',
        },
      }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    email.setFailNext(new Error('smtp down'));
    const svc = buildSvc(prisma, email);
    const result = await svc.tick();
    expect(result.failed).toBe(1);
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].failureReason).toContain('smtp down');
    expect(rows[0].enqueuedAt).toBeNull();
  });

  it('rows already enqueued are not reprocessed', async () => {
    const rows = [
      makeRow({
        jobName: 'guest-notification',
        payload: { event: 'inquiry.acknowledged', guestEmail: 'a@b' },
        enqueuedAt: new Date(),
      }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    const svc = buildSvc(prisma, email);
    const result = await svc.tick();
    expect(result.processed).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('unknown jobName errors gracefully (counts as failure, not a crash)', async () => {
    const rows = [
      makeRow({ jobName: 'wat', payload: { event: 'x' } }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    const svc = buildSvc(prisma, email);
    const result = await svc.tick();
    expect(result.failed).toBe(1);
    expect(rows[0].failureReason).toMatch(/Unknown outbox jobName/);
  });

  it('unknown event errors gracefully', async () => {
    const rows = [
      makeRow({
        jobName: 'guest-notification',
        payload: { event: 'no-such-event', guestEmail: 'a@b' },
      }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    const svc = buildSvc(prisma, email);
    const result = await svc.tick();
    expect(result.failed).toBe(1);
    expect(rows[0].failureReason).toMatch(/Unknown outbox event/);
  });

  it('admin-notification with missing ADMIN_NOTIFICATION_EMAIL fails clearly', async () => {
    const original = process.env.ADMIN_NOTIFICATION_EMAIL;
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    const rows = [
      makeRow({
        jobName: 'admin-notification',
        payload: {
          event: 'inquiry.new',
          inquiryId: 'i1',
          guestName: 'Jane',
          checkIn: '2026-07-15',
          checkOut: '2026-07-18',
        },
      }),
    ];
    const prisma = buildPrisma(rows);
    const email = buildFakeEmail();
    const svc = buildSvc(prisma, email);
    await svc.tick();
    expect(rows[0].failureReason).toMatch(/no recipient/i);
    process.env.ADMIN_NOTIFICATION_EMAIL = original;
  });
});
