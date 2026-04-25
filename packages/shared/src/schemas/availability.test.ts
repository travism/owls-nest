import { describe, it, expect } from 'vitest';
import {
  AvailabilityRequestSchema,
  AvailabilityResponseSchema,
  UnavailableRangeSchema,
} from './availability';

describe('AvailabilityRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(
      AvailabilityRequestSchema.safeParse({
        from: '2026-07-01',
        to: '2026-08-01',
      }).success,
    ).toBe(true);
  });

  it('rejects to <= from', () => {
    expect(
      AvailabilityRequestSchema.safeParse({
        from: '2026-07-01',
        to: '2026-07-01',
      }).success,
    ).toBe(false);
    expect(
      AvailabilityRequestSchema.safeParse({
        from: '2026-08-01',
        to: '2026-07-01',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed dates', () => {
    expect(
      AvailabilityRequestSchema.safeParse({ from: '7/1/26', to: '2026-08-01' })
        .success,
    ).toBe(false);
  });
});

describe('UnavailableRangeSchema', () => {
  it('accepts a valid range', () => {
    expect(
      UnavailableRangeSchema.safeParse({
        startDate: '2026-07-15',
        endDate: '2026-07-18',
      }).success,
    ).toBe(true);
  });
});

describe('AvailabilityResponseSchema', () => {
  it('accepts a complete response', () => {
    expect(
      AvailabilityResponseSchema.safeParse({
        from: '2026-07-01',
        to: '2026-08-01',
        unavailable: [
          { startDate: '2026-07-15', endDate: '2026-07-18' },
          { startDate: '2026-07-22', endDate: '2026-07-24' },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts an empty unavailable array', () => {
    expect(
      AvailabilityResponseSchema.safeParse({
        from: '2026-07-01',
        to: '2026-08-01',
        unavailable: [],
      }).success,
    ).toBe(true);
  });
});
