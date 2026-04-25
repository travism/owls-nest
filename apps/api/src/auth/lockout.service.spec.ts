import { LockoutService } from './lockout.service';

// Lightweight Prisma mock — avoids spinning up a DB for this unit test.
function mockPrisma(initial: { failedAttempts: number; lockedUntil: Date | null }) {
  let state = { ...initial };
  return {
    state: () => ({ ...state }),
    adminUser: {
      findUnique: jest.fn(async () => ({ lockedUntil: state.lockedUntil })),
      update: jest.fn(async ({ data }: { data: any }) => {
        if (data.failedAttempts?.increment) {
          state.failedAttempts += data.failedAttempts.increment;
        } else if (typeof data.failedAttempts === 'number') {
          state.failedAttempts = data.failedAttempts;
        }
        if ('lockedUntil' in data) state.lockedUntil = data.lockedUntil;
        return { failedAttempts: state.failedAttempts };
      }),
    },
  };
}

describe('LockoutService', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  it('reports unlocked when lockedUntil is null', async () => {
    const prisma = mockPrisma({ failedAttempts: 0, lockedUntil: null });
    const svc = new LockoutService(prisma as any);
    expect(await svc.isLocked(userId)).toBe(false);
  });

  it('reports unlocked when lockedUntil is in the past', async () => {
    const prisma = mockPrisma({ failedAttempts: 0, lockedUntil: new Date(Date.now() - 1_000) });
    const svc = new LockoutService(prisma as any);
    expect(await svc.isLocked(userId)).toBe(false);
  });

  it('reports locked when lockedUntil is in the future', async () => {
    const prisma = mockPrisma({ failedAttempts: 0, lockedUntil: new Date(Date.now() + 60_000) });
    const svc = new LockoutService(prisma as any);
    expect(await svc.isLocked(userId)).toBe(true);
  });

  it('engages lockout on the 5th failure and resets failedAttempts', async () => {
    const prisma = mockPrisma({ failedAttempts: 0, lockedUntil: null });
    const svc = new LockoutService(prisma as any);

    for (let i = 1; i <= 4; i++) {
      const r = await svc.recordFailure(userId);
      expect(r.locked).toBe(false);
      expect(r.remaining).toBe(5 - i);
    }

    const fifth = await svc.recordFailure(userId);
    expect(fifth.locked).toBe(true);
    expect(prisma.state().lockedUntil).toBeInstanceOf(Date);
    expect(prisma.state().lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(prisma.state().failedAttempts).toBe(0); // reset after lockout
  });

  it('clears state on success', async () => {
    const prisma = mockPrisma({ failedAttempts: 3, lockedUntil: new Date(Date.now() + 5_000) });
    const svc = new LockoutService(prisma as any);
    await svc.recordSuccess(userId);
    expect(prisma.state().failedAttempts).toBe(0);
    expect(prisma.state().lockedUntil).toBeNull();
  });
});
