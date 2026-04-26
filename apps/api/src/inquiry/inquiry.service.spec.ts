import { InquiryService } from './inquiry.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

interface InquiryRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  checkIn: Date;
  checkOut: Date;
  message: string | null;
  status: string;
  convertedBookingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mockPrisma() {
  const inquiries: InquiryRow[] = [];
  const outboxRows: any[] = [];
  let nextId = 1;
  return {
    rows: () => inquiries,
    outbox: () => outboxRows,
    inquiry: {
      create: jest.fn(async ({ data }: any) => {
        const row: InquiryRow = {
          id: `inq-${nextId++}`,
          name: data.name,
          email: data.email,
          phone: data.phone ?? null,
          checkIn: data.checkIn,
          checkOut: data.checkOut,
          message: data.message ?? null,
          status: data.status,
          convertedBookingId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        inquiries.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        inquiries.find((r) => r.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) => {
        let result = inquiries.slice();
        if (where?.status) result = result.filter((r) => r.status === where.status);
        return result;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const idx = inquiries.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error('not found');
        inquiries[idx] = { ...inquiries[idx], ...data, updatedAt: new Date() };
        return inquiries[idx];
      }),
    },
    outboxModel: {
      create: jest.fn(async ({ data }: any) => {
        outboxRows.push(data);
        return data;
      }),
    },
    // $transaction is replaced with the real tx surface in buildPrisma below.
    $transaction: jest.fn(),
  };
}

function buildPrisma() {
  const m = mockPrisma();
  const innerTx = { inquiry: m.inquiry, outbox: m.outboxModel };
  m.$transaction = jest.fn(async (fn: any) => fn(innerTx));
  return m;
}

const VALID_INPUT = {
  name: 'Jane Smith',
  email: 'jane@example.com',
  phone: '+1 555 0100',
  checkIn: '2026-07-15',
  checkOut: '2026-07-18',
  message: 'Looking forward to visiting Smith Rock!',
};

// InquiryService.convert delegates to BookingService.convertInquiry. The
// real conversion logic (validation, Booking + Guest creation) is unit-tested
// in booking.service.spec.ts and exercised end-to-end in inquiry.e2e-spec.ts.
// This stub stamps the inquiry as 'converted' so InquiryService.convert can
// refetch and return the right shape.
function fakeBookings(prisma: ReturnType<typeof buildPrisma>) {
  return {
    convertInquiry: jest.fn(async (id: string) => {
      const row = prisma.rows().find((r) => r.id === id);
      if (!row) throw new Error('not found');
      if (row.status === 'converted')
        throw new (require('@nestjs/common').ConflictException)({
          code: 'CONFLICT',
          message: 'Inquiry already converted.',
        });
      if (row.status === 'closed')
        throw new (require('@nestjs/common').BadRequestException)({
          code: 'VALIDATION_FAILED',
          message: 'Closed inquiries cannot be converted.',
        });
      row.status = 'converted';
      return { id: 'booking-fake' } as any;
    }),
  };
}

describe('InquiryService', () => {
  it('creates an inquiry and writes an outbox row in the same transaction', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const result = await svc.create(VALID_INPUT);
    expect(result.name).toBe('Jane Smith');
    expect(result.status).toBe('new');
    expect(result.checkIn).toBe('2026-07-15');
    expect(result.checkOut).toBe('2026-07-18');

    expect(prisma.outbox()).toHaveLength(1);
    const out = prisma.outbox()[0];
    expect(out.jobName).toBe('admin-notification');
    expect(out.idempotencyKey).toMatch(/^inquiry\.new:/);
    expect(out.payload).toMatchObject({ event: 'inquiry.new' });
  });

  it('serializes phone and message as null when not provided', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const { phone, message, ...input } = VALID_INPUT;
    void phone; void message;
    const result = await svc.create(input as any);
    expect(result.phone).toBeNull();
    expect(result.message).toBeNull();
  });

  it('lists inquiries, optionally filtering by status', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    await svc.create(VALID_INPUT);
    await svc.create(VALID_INPUT);
    expect(await svc.list()).toHaveLength(2);
  });

  it('getById returns 404 for unknown id', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    await expect(svc.getById('nonexistent')).rejects.toThrow(NotFoundException);
  });

  // ---- transitions ----

  it('allows new → responded', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    const updated = await svc.transition(created.id, 'responded');
    expect(updated.status).toBe('responded');
  });

  it('allows new → closed', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    const updated = await svc.transition(created.id, 'closed');
    expect(updated.status).toBe('closed');
  });

  it('allows responded → closed', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    await svc.transition(created.id, 'responded');
    const closed = await svc.transition(created.id, 'closed');
    expect(closed.status).toBe('closed');
  });

  it('rejects illegal transition (closed → responded)', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    await svc.transition(created.id, 'closed');
    await expect(svc.transition(created.id, 'responded')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects transition on unknown inquiry', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    await expect(svc.transition('nope', 'responded')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ---- conversion ----

  it('converts a new inquiry', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    const converted = await svc.convert(created.id);
    expect(converted.status).toBe('converted');
  });

  it('converts a responded inquiry', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    await svc.transition(created.id, 'responded');
    const converted = await svc.convert(created.id);
    expect(converted.status).toBe('converted');
  });

  it('rejects converting a closed inquiry', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    await svc.transition(created.id, 'closed');
    await expect(svc.convert(created.id)).rejects.toThrow(BadRequestException);
  });

  it('rejects double-convert with CONFLICT', async () => {
    const prisma = buildPrisma();
    const svc = new InquiryService(prisma as any, fakeBookings(prisma) as any);
    const created = await svc.create(VALID_INPUT);
    await svc.convert(created.id);
    await expect(svc.convert(created.id)).rejects.toThrow(ConflictException);
  });
});
