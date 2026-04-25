import { BlockedDateService } from './blocked-date.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const PROPERTY_ID = '00000000-0000-0000-0000-000000000001';

function mockPrisma(opts: { hasProperty?: boolean; existingBlock?: any | null } = {}) {
  const blocks: any[] = [];
  return {
    blocks: () => blocks,
    property: {
      findFirst: jest.fn(async () => (opts.hasProperty !== false ? { id: PROPERTY_ID } : null)),
    },
    blockedDate: {
      findMany: jest.fn(async () => blocks),
      findUnique: jest.fn(async ({ where }: any) => {
        if (opts.existingBlock !== undefined) return opts.existingBlock;
        return blocks.find((b) => b.id === where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = {
          id: `block-${blocks.length + 1}`,
          propertyId: data.propertyId,
          startDate: data.startDate,
          endDate: data.endDate,
          reason: data.reason,
          sourceSummary: data.sourceSummary,
          sourcePlatform: null,
        };
        blocks.push(created);
        return created;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const idx = blocks.findIndex((b) => b.id === where.id);
        if (idx >= 0) blocks.splice(idx, 1);
        return { id: where.id };
      }),
    },
  };
}

describe('BlockedDateService', () => {
  it('creates a manual block', async () => {
    const prisma = mockPrisma();
    const svc = new BlockedDateService(prisma as any);
    const created = await svc.create({
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      reason: 'manual_block',
    });
    expect(created.startDate).toBe('2026-08-01');
    expect(created.endDate).toBe('2026-08-04');
    expect(created.reason).toBe('manual_block');
    expect(prisma.blocks()).toHaveLength(1);
  });

  it('creates a maintenance block with note', async () => {
    const prisma = mockPrisma();
    const svc = new BlockedDateService(prisma as any);
    const created = await svc.create({
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      reason: 'maintenance',
      note: 'HVAC service',
    });
    expect(created.reason).toBe('maintenance');
    expect(created.sourceSummary).toBe('HVAC service');
  });

  it('rejects endDate <= startDate at the service layer', async () => {
    const prisma = mockPrisma();
    const svc = new BlockedDateService(prisma as any);
    await expect(
      svc.create({
        startDate: '2026-08-10',
        endDate: '2026-08-10',
        reason: 'manual_block',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NOT_FOUND when no property is configured', async () => {
    const prisma = mockPrisma({ hasProperty: false });
    const svc = new BlockedDateService(prisma as any);
    await expect(
      svc.create({
        startDate: '2026-08-10',
        endDate: '2026-08-12',
        reason: 'manual_block',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists blocks ordered by start date', async () => {
    const prisma = mockPrisma();
    const svc = new BlockedDateService(prisma as any);
    await svc.create({ startDate: '2026-08-10', endDate: '2026-08-12', reason: 'maintenance' });
    await svc.create({ startDate: '2026-08-01', endDate: '2026-08-04', reason: 'manual_block' });
    const list = await svc.list();
    expect(list).toHaveLength(2);
  });

  it('deletes a manual block', async () => {
    const prisma = mockPrisma();
    const svc = new BlockedDateService(prisma as any);
    const created = await svc.create({
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      reason: 'manual_block',
    });
    await svc.delete(created.id);
    expect(prisma.blocks()).toHaveLength(0);
  });

  it('refuses to delete an OTA-imported block', async () => {
    const prisma = mockPrisma({
      existingBlock: {
        id: 'ota-1',
        reason: 'ota_booking',
        sourcePlatform: 'airbnb',
      },
    });
    const svc = new BlockedDateService(prisma as any);
    await expect(svc.delete('ota-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NOT_FOUND when deleting a non-existent block', async () => {
    const prisma = mockPrisma({ existingBlock: null });
    const svc = new BlockedDateService(prisma as any);
    await expect(svc.delete('nonexistent')).rejects.toThrow(NotFoundException);
  });
});
