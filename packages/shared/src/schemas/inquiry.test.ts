import { describe, it, expect } from 'vitest';
import { InquiryCreateSchema } from './inquiry';

describe('InquiryCreateSchema', () => {
  const valid = {
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1 555 0100',
    checkIn: '2026-07-15',
    checkOut: '2026-07-18',
    numGuests: 2,
    petCount: 0,
    message: 'Looking forward to staying!',
  };

  it('accepts a valid inquiry', () => {
    expect(InquiryCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an inquiry without optional fields', () => {
    const { message, ...rest } = valid;
    void message;
    expect(InquiryCreateSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects missing phone', () => {
    const { phone, ...rest } = valid;
    void phone;
    const result = InquiryCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = InquiryCreateSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = InquiryCreateSchema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects malformed dates', () => {
    const result = InquiryCreateSchema.safeParse({ ...valid, checkIn: '7/15/2026' });
    expect(result.success).toBe(false);
  });

  it('rejects numGuests < 1', () => {
    const result = InquiryCreateSchema.safeParse({ ...valid, numGuests: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects petCount > 2', () => {
    const result = InquiryCreateSchema.safeParse({ ...valid, petCount: 3 });
    expect(result.success).toBe(false);
  });

  it('defaults petCount to 0 when omitted', () => {
    const { petCount, ...rest } = valid;
    void petCount;
    const parsed = InquiryCreateSchema.parse(rest);
    expect(parsed.petCount).toBe(0);
  });

  it('rejects checkOut before or equal to checkIn', () => {
    const sameDate = InquiryCreateSchema.safeParse({
      ...valid,
      checkIn: '2026-07-15',
      checkOut: '2026-07-15',
    });
    expect(sameDate.success).toBe(false);

    const reversed = InquiryCreateSchema.safeParse({
      ...valid,
      checkIn: '2026-07-20',
      checkOut: '2026-07-15',
    });
    expect(reversed.success).toBe(false);
  });
});
