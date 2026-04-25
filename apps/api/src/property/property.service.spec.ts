import { PropertyService } from './property.service';
import { NotFoundException } from '@nestjs/common';

const SEED = {
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
  cancellationPolicy: { tiers: [{ daysBeforeCheckin: 30, refundPercent: 100 }] },
};

function mockPrisma(initial: any | null) {
  let state = initial ? { ...initial } : null;
  return {
    state: () => state,
    property: {
      findFirst: jest.fn(async (args: any) => {
        if (!state) return null;
        if (args?.select?.id) return { id: state.id };
        return state;
      }),
      update: jest.fn(async ({ data }: { data: any }) => {
        state = { ...state, ...data };
        return state;
      }),
    },
  };
}

describe('PropertyService', () => {
  it('returns the seeded property', async () => {
    const prisma = mockPrisma(SEED);
    const svc = new PropertyService(prisma as any);
    const p = await svc.getProperty();
    expect(p.name).toBe("The Owl's Nest");
    expect(typeof p.baseNightlyRate).toBe('number');
  });

  it('throws NOT_FOUND when no property is configured', async () => {
    const prisma = mockPrisma(null);
    const svc = new PropertyService(prisma as any);
    await expect(svc.getProperty()).rejects.toThrow(NotFoundException);
  });

  it('updates a single field', async () => {
    const prisma = mockPrisma(SEED);
    const svc = new PropertyService(prisma as any);
    const updated = await svc.updateProperty({ name: 'New name' });
    expect(updated.name).toBe('New name');
    expect(updated.city).toBe('Redmond'); // unchanged
  });

  it('updates multiple fields atomically', async () => {
    const prisma = mockPrisma(SEED);
    const svc = new PropertyService(prisma as any);
    const updated = await svc.updateProperty({
      baseNightlyRate: 200,
      cleaningFee: 80,
      minStay: 3,
    });
    expect(updated.baseNightlyRate).toBe(200);
    expect(updated.cleaningFee).toBe(80);
    expect(updated.minStay).toBe(3);
  });

  it('updates the cancellation policy', async () => {
    const prisma = mockPrisma(SEED);
    const svc = new PropertyService(prisma as any);
    const newPolicy = {
      tiers: [
        { daysBeforeCheckin: 60, refundPercent: 100 },
        { daysBeforeCheckin: 7, refundPercent: 25 },
      ],
    };
    const updated = await svc.updateProperty({ cancellationPolicy: newPolicy });
    expect(updated.cancellationPolicy).toEqual(newPolicy);
  });

  it('throws NOT_FOUND on update when no property exists', async () => {
    const prisma = mockPrisma(null);
    const svc = new PropertyService(prisma as any);
    await expect(svc.updateProperty({ name: 'X' })).rejects.toThrow(NotFoundException);
  });
});
