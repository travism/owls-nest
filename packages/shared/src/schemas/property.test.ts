import { describe, it, expect } from 'vitest';
import {
  PropertySchema,
  PropertyUpdateSchema,
  CancellationPolicySchema,
  TimeOfDaySchema,
} from './property';

describe('TimeOfDaySchema', () => {
  it.each(['00:00:00', '15:00:00', '23:59:59', '11:00:00'])('accepts %s', (t) => {
    expect(TimeOfDaySchema.safeParse(t).success).toBe(true);
  });
  it.each(['24:00:00', '15:60:00', '15:00:60', '15:00', '3pm', ''])('rejects %s', (t) => {
    expect(TimeOfDaySchema.safeParse(t).success).toBe(false);
  });
});

describe('CancellationPolicySchema', () => {
  it('accepts a tiered policy', () => {
    const result = CancellationPolicySchema.safeParse({
      tiers: [
        { daysBeforeCheckin: 30, refundPercent: 100 },
        { daysBeforeCheckin: 14, refundPercent: 50 },
        { daysBeforeCheckin: 0, refundPercent: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });
  it('rejects refundPercent out of range', () => {
    expect(
      CancellationPolicySchema.safeParse({
        tiers: [{ daysBeforeCheckin: 30, refundPercent: 150 }],
      }).success,
    ).toBe(false);
  });
  it('rejects empty tiers', () => {
    expect(CancellationPolicySchema.safeParse({ tiers: [] }).success).toBe(false);
  });
});

describe('PropertySchema', () => {
  const valid = {
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
  };

  it('accepts a complete property', () => {
    expect(PropertySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects state with wrong length', () => {
    expect(PropertySchema.safeParse({ ...valid, state: 'Oregon' }).success).toBe(false);
  });

  it('rejects negative pricing', () => {
    expect(PropertySchema.safeParse({ ...valid, baseNightlyRate: -1 }).success).toBe(false);
    expect(PropertySchema.safeParse({ ...valid, cleaningFee: -1 }).success).toBe(false);
  });

  it('rejects out-of-bounds maxGuests / minStay', () => {
    expect(PropertySchema.safeParse({ ...valid, maxGuests: 0 }).success).toBe(false);
    expect(PropertySchema.safeParse({ ...valid, maxGuests: 25 }).success).toBe(false);
    expect(PropertySchema.safeParse({ ...valid, minStay: 0 }).success).toBe(false);
    expect(PropertySchema.safeParse({ ...valid, minStay: 31 }).success).toBe(false);
  });
});

describe('PropertyUpdateSchema', () => {
  it('accepts a single-field update', () => {
    expect(PropertyUpdateSchema.safeParse({ name: 'New name' }).success).toBe(true);
  });

  it('accepts a multi-field update', () => {
    expect(
      PropertyUpdateSchema.safeParse({ baseNightlyRate: 200, cleaningFee: 80 }).success,
    ).toBe(true);
  });

  it('rejects an empty body', () => {
    const result = PropertyUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields silently (but keeps known)', () => {
    // Zod by default strips unknown keys with .object(); valid update wins.
    const result = PropertyUpdateSchema.safeParse({ name: 'X', unknown: 'y' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('unknown');
  });
});
