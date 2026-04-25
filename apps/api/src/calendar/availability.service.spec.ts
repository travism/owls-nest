import { AvailabilityService } from './availability.service';

interface BookingFixture {
  status: string;
  checkIn: Date;
  checkOut: Date;
}

interface BlockFixture {
  startDate: Date;
  endDate: Date;
}

function mockPrisma(opts: { bookings?: BookingFixture[]; blocks?: BlockFixture[] } = {}) {
  return {
    booking: {
      findMany: jest.fn(async ({ where }: { where: any }) => {
        const all = opts.bookings ?? [];
        return all
          .filter((b) => where.status.in.includes(b.status))
          .filter(
            (b) =>
              b.checkIn.getTime() < where.checkIn.lt.getTime() &&
              b.checkOut.getTime() > where.checkOut.gt.getTime(),
          )
          .map(({ checkIn, checkOut }) => ({ checkIn, checkOut }));
      }),
    },
    blockedDate: {
      findMany: jest.fn(async ({ where }: { where: any }) => {
        const all = opts.blocks ?? [];
        return all
          .filter(
            (b) =>
              b.startDate.getTime() < where.startDate.lt.getTime() &&
              b.endDate.getTime() > where.endDate.gt.getTime(),
          )
          .map(({ startDate, endDate }) => ({ startDate, endDate }));
      }),
    },
  };
}

const d = (s: string) => new Date(s + 'T00:00:00Z');

describe('AvailabilityService', () => {
  it('returns empty when no bookings or blocks exist', async () => {
    const svc = new AvailabilityService(mockPrisma() as any);
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-08-01'));
    expect(ranges).toEqual([]);
  });

  it('returns empty when to <= from', async () => {
    const svc = new AvailabilityService(mockPrisma() as any);
    const ranges = await svc.listUnavailableInRange(d('2026-07-15'), d('2026-07-15'));
    expect(ranges).toEqual([]);
  });

  it('returns confirmed direct booking dates', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          { status: 'confirmed', checkIn: d('2026-07-15'), checkOut: d('2026-07-18') },
        ],
      }) as any,
    );
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-08-01'));
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startDate).toEqual(d('2026-07-15'));
    expect(ranges[0].endDate).toEqual(d('2026-07-18'));
  });

  it('includes pending_approval bookings (held inventory)', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          { status: 'pending_approval', checkIn: d('2026-07-15'), checkOut: d('2026-07-18') },
        ],
      }) as any,
    );
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-08-01'));
    expect(ranges).toHaveLength(1);
  });

  it('excludes inquiry-status bookings (no commitment yet)', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          { status: 'inquiry', checkIn: d('2026-07-15'), checkOut: d('2026-07-18') },
        ],
      }) as any,
    );
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-08-01'));
    expect(ranges).toEqual([]);
  });

  it('excludes cancelled bookings (free for re-booking)', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          { status: 'cancelled', checkIn: d('2026-07-15'), checkOut: d('2026-07-18') },
        ],
      }) as any,
    );
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-08-01'));
    expect(ranges).toEqual([]);
  });

  it('combines bookings and blocked dates, sorted by start date', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          { status: 'confirmed', checkIn: d('2026-07-22'), checkOut: d('2026-07-25') },
          { status: 'confirmed', checkIn: d('2026-07-10'), checkOut: d('2026-07-12') },
        ],
        blocks: [{ startDate: d('2026-07-15'), endDate: d('2026-07-18') }],
      }) as any,
    );
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-08-01'));
    expect(ranges).toHaveLength(3);
    expect(ranges[0].startDate).toEqual(d('2026-07-10'));
    expect(ranges[1].startDate).toEqual(d('2026-07-15'));
    expect(ranges[2].startDate).toEqual(d('2026-07-22'));
  });

  it('includes OTA-imported blocks (any reason)', async () => {
    // The service treats all BlockedDate rows uniformly — reason filter
    // is irrelevant for "what dates can a guest book?"
    const svc = new AvailabilityService(
      mockPrisma({
        blocks: [{ startDate: d('2026-08-10'), endDate: d('2026-08-12') }],
      }) as any,
    );
    const ranges = await svc.listUnavailableInRange(d('2026-07-01'), d('2026-09-01'));
    expect(ranges).toHaveLength(1);
  });

  it('checkAvailability returns available=true when no conflicts', async () => {
    const svc = new AvailabilityService(mockPrisma() as any);
    const result = await svc.checkAvailability(d('2026-07-15'), d('2026-07-18'));
    expect(result.available).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('checkAvailability returns conflicts when overlapping', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          { status: 'confirmed', checkIn: d('2026-07-16'), checkOut: d('2026-07-20') },
        ],
      }) as any,
    );
    const result = await svc.checkAvailability(d('2026-07-15'), d('2026-07-18'));
    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(1);
  });

  it('checkAvailability allows same-day turnaround (one departs, one arrives)', async () => {
    const svc = new AvailabilityService(
      mockPrisma({
        bookings: [
          // Existing booking: checkOut on July 18 = July 18 is available for new check-in
          { status: 'confirmed', checkIn: d('2026-07-15'), checkOut: d('2026-07-18') },
        ],
      }) as any,
    );
    const result = await svc.checkAvailability(d('2026-07-18'), d('2026-07-21'));
    expect(result.available).toBe(true);
  });
});
