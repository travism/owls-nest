import { CalendarExportService } from './calendar-export.service';

interface BookingFixture {
  id: string;
  source: string;
  status: string;
  checkIn: Date;
  checkOut: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface BlockFixture {
  id: string;
  reason: string;
  startDate: Date;
  endDate: Date;
  sourceSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mockPrisma(opts: { bookings?: BookingFixture[]; blocks?: BlockFixture[] } = {}) {
  return {
    booking: {
      findMany: jest.fn(async ({ where }: { where: any }) => {
        const all = opts.bookings ?? [];
        return all
          .filter((b) =>
            (where?.source === undefined || b.source === where.source) &&
            (where?.status?.in === undefined || where.status.in.includes(b.status)),
          )
          .map(({ id, checkIn, checkOut, createdAt, updatedAt }) => ({
            id,
            checkIn,
            checkOut,
            createdAt,
            updatedAt,
          }));
      }),
    },
    blockedDate: {
      findMany: jest.fn(async ({ where }: { where: any }) => {
        const all = opts.blocks ?? [];
        return all
          .filter((b) =>
            where?.reason?.in === undefined || where.reason.in.includes(b.reason),
          )
          .map(({ id, startDate, endDate, reason, sourceSummary, createdAt, updatedAt }) => ({
            id,
            startDate,
            endDate,
            reason,
            sourceSummary,
            createdAt,
            updatedAt,
          }));
      }),
    },
  };
}

const baseDates = {
  createdAt: new Date('2026-04-25T12:00:00Z'),
  updatedAt: new Date('2026-04-25T12:00:00Z'),
};

function booking(id: string, source: string, status: string): BookingFixture {
  return {
    id,
    source,
    status,
    checkIn: new Date('2026-07-15T00:00:00Z'),
    checkOut: new Date('2026-07-18T00:00:00Z'),
    ...baseDates,
  };
}

function block(id: string, reason: string, summary: string | null = null): BlockFixture {
  return {
    id,
    reason,
    sourceSummary: summary,
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: new Date('2026-08-04T00:00:00Z'),
    ...baseDates,
  };
}

describe('CalendarExportService', () => {
  it('generates a valid empty VCALENDAR when there is nothing to export', async () => {
    const svc = new CalendarExportService(mockPrisma() as any);
    const ics = await svc.generateExportFeed();
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toMatch(/\r\nEND:VCALENDAR$/);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  // ---- Inclusion paths ✅ ----

  it('includes a confirmed direct booking', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b1', 'direct', 'confirmed')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).toContain('UID:booking-b1@owlsnest.com');
    expect(ics).toContain('SUMMARY:Reserved');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260715');
    expect(ics).toContain('DTEND;VALUE=DATE:20260718');
  });

  it('includes an approved (awaiting payment) direct booking', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b2', 'direct', 'approved')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).toContain('UID:booking-b2@owlsnest.com');
  });

  it('includes a completed direct booking', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b3', 'direct', 'completed')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).toContain('UID:booking-b3@owlsnest.com');
  });

  it('includes a manual_block', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ blocks: [block('m1', 'manual_block', 'Owner stay')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).toContain('UID:block-m1@owlsnest.com');
    expect(ics).toContain('SUMMARY:Not available');
    expect(ics).toContain('DESCRIPTION:Owner stay');
  });

  it('includes a maintenance block', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ blocks: [block('m2', 'maintenance')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).toContain('UID:block-m2@owlsnest.com');
    expect(ics).toContain('DESCRIPTION:Maintenance block');
  });

  // ---- Exclusion paths ❌ ----

  it('excludes a Booking with source=airbnb (would reflect OTA back to itself)', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b-air', 'airbnb', 'confirmed')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:booking-b-air');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('excludes a Booking with source=vrbo', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b-vrbo', 'vrbo', 'confirmed')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:booking-b-vrbo');
  });

  it('excludes a Booking with source=booking_com', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b-bc', 'booking_com', 'confirmed')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:booking-b-bc');
  });

  it('excludes a Booking in inquiry status', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b-inq', 'direct', 'inquiry')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:booking-b-inq');
  });

  it('excludes a Booking in pending_approval status', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b-pend', 'direct', 'pending_approval')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:booking-b-pend');
  });

  it('excludes a Booking in cancelled status', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ bookings: [booking('b-cancel', 'direct', 'cancelled')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:booking-b-cancel');
  });

  it('excludes a BlockedDate with reason=ota_booking (no matter the platform)', async () => {
    const svc = new CalendarExportService(
      mockPrisma({ blocks: [block('m-ota', 'ota_booking', 'Airbnb guest')] }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).not.toContain('UID:block-m-ota');
  });

  // ---- Mixed scenarios ----

  it('handles a mix correctly — only direct + manual/maintenance survive', async () => {
    const svc = new CalendarExportService(
      mockPrisma({
        bookings: [
          booking('keep1', 'direct', 'confirmed'),
          booking('drop1', 'airbnb', 'confirmed'),
          booking('drop2', 'direct', 'cancelled'),
        ],
        blocks: [
          block('keep2', 'manual_block'),
          block('drop3', 'ota_booking'),
        ],
      }) as any,
    );
    const ics = await svc.generateExportFeed();
    expect(ics).toContain('UID:booking-keep1@owlsnest.com');
    expect(ics).toContain('UID:block-keep2@owlsnest.com');
    expect(ics).not.toContain('drop1');
    expect(ics).not.toContain('drop2');
    expect(ics).not.toContain('drop3');
  });

  it('UIDs are stable across consecutive calls (re-export idempotency)', async () => {
    const prisma = mockPrisma({
      bookings: [booking('stable', 'direct', 'confirmed')],
      blocks: [block('blk-stable', 'manual_block')],
    });
    const svc = new CalendarExportService(prisma as any);
    const ics1 = await svc.generateExportFeed();
    const ics2 = await svc.generateExportFeed();
    const extractUids = (ics: string) =>
      [...ics.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1]);
    expect(extractUids(ics1)).toEqual(extractUids(ics2));
  });
});
