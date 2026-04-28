import {
  resolveCancellation,
  calculateRefundCents,
  type CancellationPolicy,
} from './cancellation-policy';

const POLICY: CancellationPolicy = {
  tiers: [
    { daysBeforeCheckin: 30, refundPercent: 100 },
    { daysBeforeCheckin: 14, refundPercent: 50 },
    { daysBeforeCheckin: 0, refundPercent: 0 },
  ],
};

function dateAt(daysFromNow: number, baseISO = '2026-08-01T12:00:00Z'): Date {
  const base = new Date(baseISO);
  return new Date(base.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
}

describe('resolveCancellation', () => {
  const NOW = new Date('2026-08-01T12:00:00Z');

  it('30 days before -> 100% tier', () => {
    expect(resolveCancellation(POLICY, dateAt(30), NOW).tier.refundPercent).toBe(100);
  });
  it('31 days before -> 100% tier', () => {
    expect(resolveCancellation(POLICY, dateAt(31), NOW).tier.refundPercent).toBe(100);
  });
  it('29 days before -> 50% tier', () => {
    expect(resolveCancellation(POLICY, dateAt(29), NOW).tier.refundPercent).toBe(50);
  });
  it('14 days before -> 50% tier (boundary)', () => {
    expect(resolveCancellation(POLICY, dateAt(14), NOW).tier.refundPercent).toBe(50);
  });
  it('15 days before -> 50% tier', () => {
    expect(resolveCancellation(POLICY, dateAt(15), NOW).tier.refundPercent).toBe(50);
  });
  it('13 days before -> 0% tier', () => {
    expect(resolveCancellation(POLICY, dateAt(13), NOW).tier.refundPercent).toBe(0);
  });
  it('0 days (same day) -> 0% tier', () => {
    expect(resolveCancellation(POLICY, dateAt(0), NOW).tier.refundPercent).toBe(0);
  });
  it('-1 days (after checkin) -> falls back to lowest tier', () => {
    const r = resolveCancellation(POLICY, dateAt(-1), NOW);
    expect(r.tier.refundPercent).toBe(0);
    expect(r.daysRemaining).toBe(-1);
  });

  it('handles unsorted tiers', () => {
    const unsorted: CancellationPolicy = {
      tiers: [
        { daysBeforeCheckin: 0, refundPercent: 0 },
        { daysBeforeCheckin: 30, refundPercent: 100 },
        { daysBeforeCheckin: 14, refundPercent: 50 },
      ],
    };
    expect(resolveCancellation(unsorted, dateAt(35), NOW).tier.refundPercent).toBe(100);
    expect(resolveCancellation(unsorted, dateAt(20), NOW).tier.refundPercent).toBe(50);
  });

  it('throws on empty tiers', () => {
    expect(() => resolveCancellation({ tiers: [] }, dateAt(30), NOW)).toThrow();
  });
});

describe('calculateRefundCents', () => {
  it('100% of full amount', () => {
    expect(calculateRefundCents(100, 0, 100)).toBe(10000);
  });
  it('50% of full amount, no rounding', () => {
    expect(calculateRefundCents(100, 0, 50)).toBe(5000);
  });
  it('rounds down on fractional cents', () => {
    // 663 * 0.5 * 100 = 33150 cents, exact. Use a fractional case.
    expect(calculateRefundCents(0.999, 0, 50)).toBe(Math.floor(0.999 * 100 * 0.5));
  });
  it('subtracts alreadyRefunded before applying percent', () => {
    expect(calculateRefundCents(200, 50, 50)).toBe(7500); // (200-50) * 0.5 * 100
  });
  it('zero refund percent → 0', () => {
    expect(calculateRefundCents(500, 0, 0)).toBe(0);
  });
  it('fully refunded already → 0', () => {
    expect(calculateRefundCents(100, 100, 100)).toBe(0);
  });
  it('over-refunded clamps to 0', () => {
    expect(calculateRefundCents(100, 150, 100)).toBe(0);
  });
});
