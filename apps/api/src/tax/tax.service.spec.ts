import { TaxService } from './tax.service';
import { NotFoundException } from '@nestjs/common';

function mockPrisma(jurisdictions: Array<{
  jurisdictionLevel: string;
  taxRate: number | string;
  adminFeeRate?: number | string | null;
  exemptThresholdNights?: number;
}>) {
  return {
    taxJurisdiction: {
      findMany: jest.fn(async () =>
        jurisdictions.map((j) => ({
          jurisdictionLevel: j.jurisdictionLevel,
          taxRate: j.taxRate,
          adminFeeRate: j.adminFeeRate ?? null,
          exemptThresholdNights: j.exemptThresholdNights ?? 30,
        })),
      ),
    },
  };
}

const PROPERTY_ID = '00000000-0000-0000-0000-000000000001';

describe('TaxService', () => {
  it('calculates state + city tax for a 3-night stay (sample from tax plan §5.3)', async () => {
    const prisma = mockPrisma([
      { jurisdictionLevel: 'state', taxRate: 0.015, adminFeeRate: 0.05 },
      { jurisdictionLevel: 'city', taxRate: 0.09 },
    ]);
    const svc = new TaxService(prisma as any);

    // 3 nights × $175 = $525
    const result = await svc.calculateTax(PROPERTY_ID, 525, 3);

    expect(result.taxExempt).toBe(false);
    expect(result.stateTltRate).toBe(0.015);
    expect(result.cityTltRate).toBe(0.09);
    expect(result.stateTltAmount).toBe(7.87); // 525 * 0.015 = 7.875 → floor 7.87
    expect(result.cityTltAmount).toBe(47.25);
    expect(result.totalTax).toBe(55.12);
    expect(result.totalWithTax).toBe(580.12);
    expect(result.stateAdminFeeRetained).toBe(0.39); // 7.87 * 0.05 = 0.3935 → floor 0.39
  });

  it('exempts stays of 30+ nights', async () => {
    const prisma = mockPrisma([
      { jurisdictionLevel: 'state', taxRate: 0.015, adminFeeRate: 0.05 },
      { jurisdictionLevel: 'city', taxRate: 0.09 },
    ]);
    const svc = new TaxService(prisma as any);

    // 30 nights × $175 = $5250 (exactly at threshold)
    const r30 = await svc.calculateTax(PROPERTY_ID, 5250, 30);
    expect(r30.taxExempt).toBe(true);
    expect(r30.totalTax).toBe(0);
    expect(r30.totalWithTax).toBe(5250);

    // 31 nights — also exempt
    const r31 = await svc.calculateTax(PROPERTY_ID, 5425, 31);
    expect(r31.taxExempt).toBe(true);
  });

  it('does NOT exempt stays of 29 or fewer nights', async () => {
    const prisma = mockPrisma([
      { jurisdictionLevel: 'state', taxRate: 0.015, adminFeeRate: 0.05 },
      { jurisdictionLevel: 'city', taxRate: 0.09 },
    ]);
    const svc = new TaxService(prisma as any);
    const r = await svc.calculateTax(PROPERTY_ID, 5075, 29);
    expect(r.taxExempt).toBe(false);
    expect(r.totalTax).toBeGreaterThan(0);
  });

  it('rounds down to the nearest cent (Oregon statute)', async () => {
    const prisma = mockPrisma([
      { jurisdictionLevel: 'state', taxRate: 0.015, adminFeeRate: 0.05 },
      { jurisdictionLevel: 'city', taxRate: 0.09 },
    ]);
    const svc = new TaxService(prisma as any);

    // Subtotal that produces an awkward decimal: $123.45
    const result = await svc.calculateTax(PROPERTY_ID, 123.45, 1);
    // 123.45 * 0.015 = 1.85175 → floor 1.85
    expect(result.stateTltAmount).toBe(1.85);
    // 123.45 * 0.09 = 11.1105 → floor 11.11
    expect(result.cityTltAmount).toBe(11.11);
  });

  it('handles missing city jurisdiction gracefully', async () => {
    const prisma = mockPrisma([
      { jurisdictionLevel: 'state', taxRate: 0.015, adminFeeRate: 0.05 },
    ]);
    const svc = new TaxService(prisma as any);
    const r = await svc.calculateTax(PROPERTY_ID, 500, 3);
    expect(r.cityTltRate).toBe(0);
    expect(r.cityTltAmount).toBe(0);
    expect(r.stateTltAmount).toBe(7.5);
  });

  it('handles missing state jurisdiction gracefully', async () => {
    const prisma = mockPrisma([{ jurisdictionLevel: 'city', taxRate: 0.09 }]);
    const svc = new TaxService(prisma as any);
    const r = await svc.calculateTax(PROPERTY_ID, 500, 3);
    expect(r.stateTltRate).toBe(0);
    expect(r.stateTltAmount).toBe(0);
    expect(r.stateAdminFeeRetained).toBe(0);
    expect(r.cityTltAmount).toBe(45);
  });

  it('throws NOT_FOUND when no jurisdictions configured', async () => {
    const prisma = mockPrisma([]);
    const svc = new TaxService(prisma as any);
    await expect(svc.calculateTax(PROPERTY_ID, 500, 3)).rejects.toThrow(NotFoundException);
  });

  it('handles zero subtotal (no tax owed)', async () => {
    const prisma = mockPrisma([
      { jurisdictionLevel: 'state', taxRate: 0.015 },
      { jurisdictionLevel: 'city', taxRate: 0.09 },
    ]);
    const svc = new TaxService(prisma as any);
    const r = await svc.calculateTax(PROPERTY_ID, 0, 1);
    expect(r.totalTax).toBe(0);
    expect(r.totalWithTax).toBe(0);
  });
});
