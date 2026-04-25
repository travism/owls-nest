import { describe, it, expect } from 'vitest';
import { PricingQuoteRequestSchema, PricingQuoteResponseSchema } from './pricing';

describe('PricingQuoteRequestSchema', () => {
  it('coerces numGuests from string (URL params)', () => {
    const result = PricingQuoteRequestSchema.safeParse({
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: '3',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.numGuests).toBe(3);
  });

  it('defaults numGuests to 2', () => {
    const result = PricingQuoteRequestSchema.safeParse({
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.numGuests).toBe(2);
  });

  it('rejects checkOut <= checkIn', () => {
    expect(
      PricingQuoteRequestSchema.safeParse({
        checkIn: '2026-07-15',
        checkOut: '2026-07-15',
      }).success,
    ).toBe(false);
  });
});

describe('PricingQuoteResponseSchema', () => {
  it('accepts a complete quote', () => {
    const quote = {
      nightlyRate: 175,
      numberOfNights: 3,
      subtotal: 525,
      taxes: {
        stateTlt: { label: 'Oregon Lodging Tax', rate: 0.015, amount: 7.87 },
        cityTlt: { label: 'Redmond Lodging Tax', rate: 0.09, amount: 47.25 },
        totalTax: 55.12,
      },
      total: 580.12,
    };
    expect(PricingQuoteResponseSchema.safeParse(quote).success).toBe(true);
  });
});
