// Unit test for OutboxController. Mocks PrismaService at the boundary —
// the e2e test (test/outbox-health.e2e-spec.ts) covers the real DB behavior.

import { OutboxController } from './outbox.controller';

describe('OutboxController', () => {
  function build(prisma: any) {
    return new OutboxController(prisma);
  }

  it('returns counts + recent dead-lettered rows', async () => {
    const recent = [
      {
        id: 'a',
        jobName: 'guest-notification',
        idempotencyKey: 'k1',
        attempts: 5,
        failureReason: 'boom',
        createdAt: new Date('2026-04-25T00:00:00Z'),
        failedAt: new Date('2026-04-26T00:00:00Z'),
      },
    ];
    const oldest = { failedAt: new Date('2026-04-20T00:00:00Z') };
    const ctrl = build({
      outbox: {
        count: jest
          .fn()
          .mockResolvedValueOnce(2) // dead-lettered
          .mockResolvedValueOnce(7), // pending
        findMany: jest.fn().mockResolvedValue(recent),
        findFirst: jest.fn().mockResolvedValue(oldest),
      },
    });
    const res = await ctrl.health();
    expect(res.deadLettered).toBe(2);
    expect(res.pending).toBe(7);
    expect(res.oldestDeadLetterAt).toBe('2026-04-20T00:00:00.000Z');
    expect(res.recent).toHaveLength(1);
    expect(res.recent[0].id).toBe('a');
    expect(res.recent[0].failedAt).toBe('2026-04-26T00:00:00.000Z');
  });

  it('returns null oldest when there are no dead-lettered rows', async () => {
    const ctrl = build({
      outbox: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const res = await ctrl.health();
    expect(res.deadLettered).toBe(0);
    expect(res.oldestDeadLetterAt).toBeNull();
    expect(res.recent).toEqual([]);
  });
});
