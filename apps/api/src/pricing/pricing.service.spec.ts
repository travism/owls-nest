import { PricingService } from './pricing.service';
import { TaxService } from '../tax/tax.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function mockPrisma(property: any | null) {
  return {
    property: { findFirst: jest.fn(async () => property) },
    taxJurisdiction: {
      findMany: jest.fn(async () => [
        { jurisdictionLevel: 'state', taxRate: 0.015, adminFeeRate: 0.05, exemptThresholdNights: 30 },
        { jurisdictionLevel: 'city', taxRate: 0.09, adminFeeRate: null, exemptThresholdNights: 30 },
      ]),
    },
  };
}

const VALID_PROPERTY = {
  id: '00000000-0000-0000-0000-000000000001',
  baseNightlyRate: 175,
  cleaningFee: 75,
  minStay: 2,
};

describe('PricingService', () => {
  it('generates a quote with cleaning baked in + two-jurisdiction tax', async () => {
    const prisma = mockPrisma(VALID_PROPERTY);
    const tax = new TaxService(prisma as any);
    const svc = new PricingService(prisma as any, tax);

    // 3 nights — base 175 × 3 + 75 cleaning = 600
    const q = await svc.getQuote(new Date('2026-07-15'), new Date('2026-07-18'));

    expect(q.numberOfNights).toBe(3);
    expect(q.nightlyRate).toBe(200); // (175 + 75/3) = 200
    expect(q.subtotal).toBe(600);
    expect(q.taxes.stateTlt.rate).toBe(0.015);
    expect(q.taxes.stateTlt.amount).toBe(9);   // 600 * 0.015 = 9.00
    expect(q.taxes.cityTlt.rate).toBe(0.09);
    expect(q.taxes.cityTlt.amount).toBe(54);   // 600 * 0.09 = 54.00
    expect(q.taxes.totalTax).toBe(63);
    expect(q.total).toBe(663);
  });

  it('rejects when checkOut <= checkIn', async () => {
    const prisma = mockPrisma(VALID_PROPERTY);
    const svc = new PricingService(prisma as any, new TaxService(prisma as any));
    await expect(
      svc.getQuote(new Date('2026-07-15'), new Date('2026-07-15')),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when stay is shorter than min-stay', async () => {
    const prisma = mockPrisma({ ...VALID_PROPERTY, minStay: 3 });
    const svc = new PricingService(prisma as any, new TaxService(prisma as any));
    await expect(
      svc.getQuote(new Date('2026-07-15'), new Date('2026-07-17')), // 2 nights
    ).rejects.toThrow(BadRequestException);
  });

  it('returns full subtotal as total when stay is 30+ nights (tax exempt)', async () => {
    const prisma = mockPrisma(VALID_PROPERTY);
    const svc = new PricingService(prisma as any, new TaxService(prisma as any));
    // 30 nights: 175 × 30 + 75 = 5325
    const q = await svc.getQuote(new Date('2026-07-01'), new Date('2026-07-31'));
    expect(q.numberOfNights).toBe(30);
    expect(q.taxes.totalTax).toBe(0);
    expect(q.total).toBe(q.subtotal);
  });

  it('throws NOT_FOUND when no property is configured', async () => {
    const prisma = mockPrisma(null);
    const svc = new PricingService(prisma as any, new TaxService(prisma as any));
    await expect(
      svc.getQuote(new Date('2026-07-15'), new Date('2026-07-18')),
    ).rejects.toThrow(NotFoundException);
  });
});
