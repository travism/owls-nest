import { describe, it, expect } from 'vitest';
import { BookingRequestSchema, BookingStatusSchema, BookingSourceSchema } from './booking';

describe('BookingRequestSchema', () => {
  const valid = {
    checkIn: '2026-07-15',
    checkOut: '2026-07-18',
    numGuests: 2,
  };

  it('accepts a minimal valid request', () => {
    expect(BookingRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects fewer than 1 guest', () => {
    expect(BookingRequestSchema.safeParse({ ...valid, numGuests: 0 }).success).toBe(false);
  });

  it('rejects more than 8 guests', () => {
    expect(BookingRequestSchema.safeParse({ ...valid, numGuests: 9 }).success).toBe(false);
  });

  it('rejects checkOut <= checkIn', () => {
    expect(
      BookingRequestSchema.safeParse({ ...valid, checkOut: '2026-07-15' }).success,
    ).toBe(false);
  });
});

describe('Booking enums', () => {
  it('accepts valid status values', () => {
    for (const s of ['inquiry', 'pending_approval', 'approved', 'confirmed', 'cancelled', 'completed']) {
      expect(BookingStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects unknown status', () => {
    expect(BookingStatusSchema.safeParse('refunded').success).toBe(false);
  });

  it('accepts valid source values', () => {
    for (const s of ['direct', 'airbnb', 'vrbo', 'booking_com', 'google']) {
      expect(BookingSourceSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects unknown source', () => {
    expect(BookingSourceSchema.safeParse('expedia').success).toBe(false);
  });
});
