import { describe, it, expect } from 'vitest';
import {
  BlockedDateCreateSchema,
  BlockedDateReasonSchema,
  BlockedDateSchema,
} from './blocked-date';

describe('BlockedDateReasonSchema', () => {
  it('accepts valid reasons', () => {
    for (const r of ['manual_block', 'maintenance', 'ota_booking']) {
      expect(BlockedDateReasonSchema.safeParse(r).success).toBe(true);
    }
  });
  it('rejects unknown reason', () => {
    expect(BlockedDateReasonSchema.safeParse('vacation').success).toBe(false);
  });
});

describe('BlockedDateCreateSchema', () => {
  it('accepts a valid block', () => {
    expect(
      BlockedDateCreateSchema.safeParse({
        startDate: '2026-07-15',
        endDate: '2026-07-18',
        reason: 'manual_block',
      }).success,
    ).toBe(true);
  });

  it('defaults reason to manual_block', () => {
    const result = BlockedDateCreateSchema.safeParse({
      startDate: '2026-07-15',
      endDate: '2026-07-18',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe('manual_block');
  });

  it('rejects ota_booking from admin (only manual / maintenance)', () => {
    const result = BlockedDateCreateSchema.safeParse({
      startDate: '2026-07-15',
      endDate: '2026-07-18',
      reason: 'ota_booking',
    });
    expect(result.success).toBe(false);
  });

  it('rejects endDate <= startDate', () => {
    expect(
      BlockedDateCreateSchema.safeParse({
        startDate: '2026-07-15',
        endDate: '2026-07-15',
      }).success,
    ).toBe(false);

    expect(
      BlockedDateCreateSchema.safeParse({
        startDate: '2026-07-15',
        endDate: '2026-07-10',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed dates', () => {
    expect(
      BlockedDateCreateSchema.safeParse({ startDate: '7/15/26', endDate: '2026-07-18' })
        .success,
    ).toBe(false);
  });
});

describe('BlockedDateSchema (response shape)', () => {
  it('accepts a complete block from the API', () => {
    expect(
      BlockedDateSchema.safeParse({
        id: '00000000-0000-0000-0000-000000000001',
        startDate: '2026-07-15',
        endDate: '2026-07-18',
        reason: 'manual_block',
        sourcePlatform: null,
        sourceSummary: null,
      }).success,
    ).toBe(true);
  });
});
