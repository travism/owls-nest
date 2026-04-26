// Pure cancellation-policy resolver.
//
// Property.cancellationPolicy is stored as JSON with the shape:
//   { tiers: [{ daysBeforeCheckin: number, refundPercent: number }, ...] }
//
// Given a check-in date and "now", we pick the tier whose daysBeforeCheckin
// threshold has been met (the highest tier we still qualify for). Falls back
// to the lowest tier if no threshold is met.

export interface CancellationTier {
  daysBeforeCheckin: number;
  refundPercent: number;
}

export interface CancellationPolicy {
  tiers: CancellationTier[];
}

export interface ResolvedCancellation {
  tier: CancellationTier;
  daysRemaining: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function resolveCancellation(
  policy: CancellationPolicy,
  checkIn: Date,
  now: Date,
): ResolvedCancellation {
  if (!policy.tiers || policy.tiers.length === 0) {
    throw new Error('Cancellation policy has no tiers configured.');
  }
  const daysRemaining = Math.floor(
    (checkIn.getTime() - now.getTime()) / MS_PER_DAY,
  );
  const sorted = [...policy.tiers].sort(
    (a, b) => b.daysBeforeCheckin - a.daysBeforeCheckin,
  );
  const match = sorted.find((t) => daysRemaining >= t.daysBeforeCheckin);
  // Fall back to the lowest tier if even the smallest threshold isn't met
  // (e.g. cancellation after check-in date).
  const tier = match ?? sorted[sorted.length - 1];
  return { tier, daysRemaining };
}

/**
 * Compute refund amount in cents for a given charge.
 *
 * `chargeAmount` and `alreadyRefunded` are in dollars; the result is rounded
 * down to the nearest cent so we never refund more than we owe.
 */
export function calculateRefundCents(
  chargeAmount: number,
  alreadyRefunded: number,
  refundPercent: number,
): number {
  const refundable = Math.max(0, chargeAmount - alreadyRefunded);
  return Math.floor(refundable * 100 * (refundPercent / 100));
}
