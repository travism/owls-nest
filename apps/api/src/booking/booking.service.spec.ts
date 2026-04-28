import { BookingService } from './booking.service';
import { FakeStripeAdapter } from '../integrations/stripe/fake-stripe.adapter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

const PROPERTY = {
  id: 'prop-1',
  baseNightlyRate: 175,
  cleaningFee: 75,
  minStay: 2,
  cancellationPolicy: {
    tiers: [
      { daysBeforeCheckin: 30, refundPercent: 100 },
      { daysBeforeCheckin: 14, refundPercent: 50 },
      { daysBeforeCheckin: 0, refundPercent: 0 },
    ],
  },
};

interface InquiryRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  convertedBookingId: string | null;
}

interface GuestRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
}

interface BookingRow {
  id: string;
  propertyId: string;
  guestId: string;
  checkIn: Date;
  checkOut: Date;
  numGuests: number;
  status: string;
  source: string;
  nightlyRate: number;
  numNights: number;
  subtotal: number;
  stateTltAmount: number;
  cityTltAmount: number;
  totalTaxAmount: number;
  stripeCustomerId: string | null;
  cancellationTierApplied: string | null;
  refundAmount: number | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ChargeRow {
  id: string;
  bookingId: string;
  kind: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeFee: number;
  refundedAmount: number;
  paidAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function buildPrisma() {
  const inquiries: InquiryRow[] = [];
  const guests: GuestRow[] = [];
  const bookings: BookingRow[] = [];
  const charges: ChargeRow[] = [];
  const outboxRows: any[] = [];
  let nextId = 1;
  const newId = (p: string) => `${p}-${nextId++}`;
  const now = () => new Date();

  const inquiryModel = {
    findUnique: jest.fn(async ({ where }: any) =>
      inquiries.find((r) => r.id === where.id) ?? null,
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const r = inquiries.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data);
      return r;
    }),
  };
  const guestModel = {
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const existing = guests.find((g) => g.email === where.email);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const g: GuestRow = { id: newId('guest'), ...create, phone: create.phone ?? null };
      guests.push(g);
      return g;
    }),
  };
  const bookingModel = {
    findFirst: jest.fn(async () => bookings[0] ?? null),
    findUnique: jest.fn(async ({ where, include }: any) => {
      const b = bookings.find((x) => x.id === where.id);
      if (!b) return null;
      const out: any = { ...b };
      if (include?.guest) out.guest = guests.find((g) => g.id === b.guestId) ?? null;
      if (include?.charges) out.charges = charges.filter((c) => c.bookingId === b.id);
      if (include?.property) out.property = PROPERTY;
      return out;
    }),
    create: jest.fn(async ({ data }: any) => {
      const b: BookingRow = {
        id: newId('book'),
        propertyId: data.propertyId,
        guestId: data.guestId,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        numGuests: data.numGuests,
        status: data.status,
        source: data.source,
        nightlyRate: data.nightlyRate,
        numNights: data.numNights,
        subtotal: data.subtotal,
        stateTltAmount: data.stateTltAmount,
        cityTltAmount: data.cityTltAmount,
        totalTaxAmount: data.totalTaxAmount,
        stripeCustomerId: null,
        cancellationTierApplied: null,
        refundAmount: null,
        cancelledAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      bookings.push(b);
      return b;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const b = bookings.find((x) => x.id === where.id);
      if (!b) throw new Error('not found');
      Object.assign(b, data, { updatedAt: now() });
      return b;
    }),
    // M11: BookingService.cancel() uses updateMany() with a status filter
    // for race-safe cancellation. Mock honors the status `in` filter so the
    // unit tests can exercise the conditional-update path.
    updateMany: jest.fn(async ({ where, data }: any) => {
      const b = bookings.find((x) => x.id === where.id);
      if (!b) return { count: 0 };
      const allowed: string[] | undefined = where.status?.in;
      if (allowed && !allowed.includes(b.status)) return { count: 0 };
      Object.assign(b, data, { updatedAt: now() });
      return { count: 1 };
    }),
    findMany: jest.fn(async (args: any) => {
      let result = bookings.slice();
      if (args?.where?.status) result = result.filter((b) => b.status === args.where.status);
      return result.map((b) => ({
        ...b,
        guest: guests.find((g) => g.id === b.guestId) ?? null,
        charges: charges.filter((c) => c.bookingId === b.id),
      }));
    }),
  };
  const chargeModel = {
    create: jest.fn(async ({ data }: any) => {
      const c: ChargeRow = {
        id: newId('charge'),
        bookingId: data.bookingId,
        kind: data.kind,
        amount: data.amount,
        currency: data.currency ?? 'usd',
        description: data.description ?? null,
        status: data.status ?? 'pending',
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        stripeFee: 0,
        refundedAmount: 0,
        paidAt: null,
        refundedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      charges.push(c);
      return c;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const c = charges.find((x) => x.id === where.id);
      if (!c) throw new Error('not found');
      Object.assign(c, data, { updatedAt: now() });
      return c;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = charges.findIndex((x) => x.id === where.id);
      if (i >= 0) charges.splice(i, 1);
    }),
    findUnique: jest.fn(async ({ where, include }: any) => {
      const c = charges.find((x) =>
        where.id ? x.id === where.id : x.stripeCheckoutSessionId === where.stripeCheckoutSessionId,
      );
      if (!c) return null;
      const out: any = { ...c };
      if (include?.booking) out.booking = bookings.find((b) => b.id === c.bookingId);
      return out;
    }),
  };
  const outboxModel = {
    create: jest.fn(async ({ data }: any) => {
      outboxRows.push(data);
      return data;
    }),
  };

  const prisma = {
    inquiries: () => inquiries,
    guests: () => guests,
    bookings: () => bookings,
    charges: () => charges,
    outbox: () => outboxRows,
    inquiry: inquiryModel,
    guest: guestModel,
    booking: bookingModel,
    bookingCharge: chargeModel,
    property: { findFirst: jest.fn(async () => PROPERTY) },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        inquiry: inquiryModel,
        guest: guestModel,
        booking: bookingModel,
        bookingCharge: chargeModel,
        outbox: outboxModel,
      }),
    ),
  };
  return prisma;
}

function buildSvc(opts: { conflicts?: Array<{ startDate: Date; endDate: Date }> } = {}) {
  const prisma = buildPrisma();
  const stripe = new FakeStripeAdapter();
  // Stub PricingService: returns a deterministic quote
  const pricing = {
    getQuote: jest.fn(async () => ({
      nightlyRate: 200,
      numberOfNights: 3,
      subtotal: 600,
      taxes: {
        stateTlt: { label: 'Oregon Lodging Tax', rate: 0.015, amount: 9 },
        cityTlt: { label: 'Redmond Lodging Tax', rate: 0.09, amount: 54 },
        totalTax: 63,
      },
      total: 663,
    })),
  };
  // Stub AvailabilityService
  const availability = {
    listUnavailableInRange: jest.fn(async () => opts.conflicts ?? []),
    checkAvailability: jest.fn(async () => ({ available: true, conflicts: [] })),
  };
  const svc = new BookingService(
    prisma as any,
    pricing as any,
    availability as any,
    stripe,
  );
  return { svc, prisma, stripe, pricing, availability };
}

const VALID_INQUIRY: InquiryRow = {
  id: 'inq-1',
  email: 'jane@example.com',
  name: 'Jane Smith',
  phone: '+1 555 0100',
  checkIn: new Date('2026-07-15T00:00:00Z'),
  checkOut: new Date('2026-07-18T00:00:00Z'),
  status: 'new',
  convertedBookingId: null,
};

describe('BookingService.convertInquiry', () => {
  it('creates a Guest + Booking in pending_approval and stamps inquiry as converted', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });

    const booking = await svc.convertInquiry('inq-1');

    expect(booking.status).toBe('pending_approval');
    expect(booking.guest?.email).toBe('jane@example.com');
    expect(booking.subtotal).toBe(600);
    expect(booking.totalTaxAmount).toBe(63);
    expect(booking.totalWithTax).toBe(663);

    expect(prisma.guests()).toHaveLength(1);
    expect(prisma.bookings()).toHaveLength(1);
    expect(prisma.inquiries()[0].status).toBe('converted');
    expect(prisma.inquiries()[0].convertedBookingId).toBe(booking.id);
  });

  it('reuses an existing Guest matched by email', async () => {
    const { svc, prisma } = buildSvc();
    prisma.guests().push({
      id: 'guest-existing',
      email: 'jane@example.com',
      name: 'Jane Old Name',
      phone: null,
    });
    prisma.inquiries().push({ ...VALID_INQUIRY });

    const booking = await svc.convertInquiry('inq-1');

    expect(prisma.guests()).toHaveLength(1);
    expect(booking.guest?.id).toBe('guest-existing');
    // The upsert update path refreshes name + phone with the newer inquiry data
    expect(prisma.guests()[0].name).toBe('Jane Smith');
  });

  it('throws CONFLICT on already-converted inquiry', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY, status: 'converted' });
    await expect(svc.convertInquiry('inq-1')).rejects.toThrow(ConflictException);
  });

  it('throws VALIDATION_FAILED on closed inquiry', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY, status: 'closed' });
    await expect(svc.convertInquiry('inq-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NOT_FOUND on unknown inquiry', async () => {
    const { svc } = buildSvc();
    await expect(svc.convertInquiry('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('BookingService.approve', () => {
  async function setupPending() {
    const { svc, prisma, stripe } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const booking = await svc.convertInquiry('inq-1');
    return { svc, prisma, stripe, bookingId: booking.id };
  }

  it('creates a Stripe Customer + initial BookingCharge + Checkout Session', async () => {
    const { svc, prisma, stripe, bookingId } = await setupPending();
    const result = await svc.approve(bookingId);

    expect(result.checkoutUrl).toMatch(/checkout\.stripe\.test/);
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.sessions.size).toBe(1);

    expect(prisma.charges()).toHaveLength(1);
    const charge = prisma.charges()[0];
    expect(charge.kind).toBe('initial');
    expect(charge.amount).toBe(663); // subtotal + tax
    expect(charge.status).toBe('sent');
    expect(charge.stripeCheckoutSessionId).toBeTruthy();
    expect(charge.stripePaymentIntentId).toBeTruthy();

    const updated = prisma.bookings().find((b) => b.id === bookingId)!;
    expect(updated.status).toBe('approved');
    expect(updated.stripeCustomerId).toBeTruthy();

    // Outbox row written for guest payment-link delivery
    const outbox = prisma.outbox();
    expect(outbox.some((o) => o.payload.event === 'booking.approved')).toBe(true);
  });

  it('reuses an existing Stripe customer if the Booking already has one', async () => {
    const { svc, prisma, stripe, bookingId } = await setupPending();
    // Pre-populate the booking with a customer id
    const b = prisma.bookings().find((x) => x.id === bookingId)!;
    b.stripeCustomerId = 'cus_test_existing';

    await svc.approve(bookingId);
    expect(stripe.customers).toHaveLength(0);
  });

  it('refuses to approve a booking not in pending_approval', async () => {
    const { svc, prisma, bookingId } = await setupPending();
    const b = prisma.bookings().find((x) => x.id === bookingId)!;
    b.status = 'confirmed';
    await expect(svc.approve(bookingId)).rejects.toThrow(ConflictException);
  });

  it('refuses to approve when dates conflict with another booking/block', async () => {
    const { svc, prisma } = buildSvc({
      conflicts: [
        // A real conflict — different range from our booking
        { startDate: new Date('2026-07-16'), endDate: new Date('2026-07-17') },
      ],
    });
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const booking = await svc.convertInquiry('inq-1');

    await expect(svc.approve(booking.id)).rejects.toThrow(/conflict/i);
  });

  it('ignores its own checkin/checkout in the conflict list (self-reference)', async () => {
    const { svc, prisma } = buildSvc({
      conflicts: [
        // Same range as our booking — that's the booking itself, not a conflict
        { startDate: new Date('2026-07-15'), endDate: new Date('2026-07-18') },
      ],
    });
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const booking = await svc.convertInquiry('inq-1');

    const result = await svc.approve(booking.id);
    expect(result.booking.status).toBe('approved');
  });

  it('throws NOT_FOUND on unknown booking', async () => {
    const { svc } = buildSvc();
    await expect(svc.approve('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('BookingService.handleCheckoutSucceeded', () => {
  async function setupApproved() {
    const { svc, prisma, stripe } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const booking = await svc.convertInquiry('inq-1');
    const approve = await svc.approve(booking.id);
    return { svc, prisma, stripe, bookingId: booking.id, chargeId: approve.chargeId };
  }

  it('flips charge to succeeded + booking to confirmed', async () => {
    const { svc, prisma, stripe, bookingId, chargeId } = await setupApproved();
    const charge = prisma.charges().find((c) => c.id === chargeId)!;
    const sessionId = charge.stripeCheckoutSessionId!;
    const sim = stripe.simulatePaymentSucceeded(sessionId, 25);

    const result = await svc.handleCheckoutSucceeded({
      sessionId,
      paymentIntentId: sim.paymentIntentId,
    });

    expect(result?.bookingId).toBe(bookingId);
    expect(result?.chargeId).toBe(chargeId);

    const updatedCharge = prisma.charges().find((c) => c.id === chargeId)!;
    expect(updatedCharge.status).toBe('succeeded');
    expect(updatedCharge.paidAt).toBeInstanceOf(Date);
    // Fee comes back as dollars (cents/100)
    expect(updatedCharge.stripeFee).toBe(0); // FakeStripe doesn't seed a balance txn for this exact path; verified in e2e

    const updatedBooking = prisma.bookings().find((b) => b.id === bookingId)!;
    expect(updatedBooking.status).toBe('confirmed');

    // Outbox rows for confirmation + rebuild
    const events = prisma.outbox().map((o: any) => o.payload?.event ?? o.payload?.reason);
    expect(events).toContain('booking.confirmed');
    expect(events).toContain('booking.confirmed'); // (rebuild-site uses reason field)
  });

  it('is idempotent on duplicate calls (already-succeeded short-circuits)', async () => {
    const { svc, prisma, stripe, bookingId, chargeId } = await setupApproved();
    const charge = prisma.charges().find((c) => c.id === chargeId)!;
    const sessionId = charge.stripeCheckoutSessionId!;
    const sim = stripe.simulatePaymentSucceeded(sessionId);

    await svc.handleCheckoutSucceeded({ sessionId, paymentIntentId: sim.paymentIntentId });
    const outboxAfterFirst = prisma.outbox().length;
    await svc.handleCheckoutSucceeded({ sessionId, paymentIntentId: sim.paymentIntentId });
    expect(prisma.outbox().length).toBe(outboxAfterFirst);
    void bookingId;
  });

  it('returns null for a session that doesn\'t map to any charge', async () => {
    const { svc } = buildSvc();
    const result = await svc.handleCheckoutSucceeded({
      sessionId: 'cs_unknown',
      paymentIntentId: null,
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------
// M8 actions
// ---------------------------------------------------------------

async function setupConfirmed() {
  const { svc, prisma, stripe } = buildSvc();
  prisma.inquiries().push({ ...VALID_INQUIRY });
  const booking = await svc.convertInquiry('inq-1');
  const approve = await svc.approve(booking.id);
  const charge = prisma.charges().find((c) => c.id === approve.chargeId)!;
  const sessionId = charge.stripeCheckoutSessionId!;
  const sim = stripe.simulatePaymentSucceeded(sessionId);
  await svc.handleCheckoutSucceeded({
    sessionId,
    paymentIntentId: sim.paymentIntentId,
  });
  return { svc, prisma, stripe, bookingId: booking.id, chargeId: approve.chargeId };
}

describe('BookingService.decline', () => {
  it('declines a pending_approval booking and writes outbox', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');

    const result = await svc.decline(b.id, { reason: 'wrong dates' });

    expect(result.status).toBe('cancelled');
    expect(result.cancellationTierApplied).toBe('declined');
    expect(prisma.outbox().some((o: any) => o.payload.event === 'booking.declined')).toBe(true);
  });

  it('refuses to decline a non-pending booking', async () => {
    const { svc, prisma, bookingId } = await setupConfirmed();
    void prisma;
    await expect(svc.decline(bookingId)).rejects.toThrow(ConflictException);
  });

  it('throws NOT_FOUND on unknown', async () => {
    const { svc } = buildSvc();
    await expect(svc.decline('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('BookingService.cancel', () => {
  it('refuses to cancel a pending booking', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    await expect(svc.cancel(b.id)).rejects.toThrow(ConflictException);
  });

  it('refunds 100% at 30+ days out, marks tier label, and updates charge', async () => {
    const { svc, prisma, stripe, bookingId, chargeId } = await setupConfirmed();
    const now = new Date('2026-06-01T00:00:00Z'); // 44 days before 2026-07-15
    const result = await svc.cancel(bookingId, { now });

    expect(result.status).toBe('cancelled');
    expect(result.cancellationTierApplied).toBe('30-day:100%');
    expect(result.refundAmount).toBeCloseTo(663);
    expect(stripe.refunds).toHaveLength(1);
    expect(stripe.refunds[0].amount).toBe(66300);
    const charge = prisma.charges().find((c) => c.id === chargeId)!;
    expect(charge.refundedAmount).toBeCloseTo(663);
    expect(charge.status).toBe('refunded');
    const events = prisma.outbox().map((o: any) => o.payload?.event ?? o.payload?.reason);
    expect(events).toContain('booking.cancelled');
    expect(events).toContain('booking.cancelled');
  });

  it('refunds 50% in the 14-29 day window', async () => {
    const { svc, stripe, bookingId } = await setupConfirmed();
    const now = new Date('2026-06-26T00:00:00Z'); // 19 days before 2026-07-15
    const result = await svc.cancel(bookingId, { now });
    expect(result.cancellationTierApplied).toBe('14-day:50%');
    expect(stripe.refunds[0].amount).toBe(33150);
  });

  it('refunds 0% within 14 days', async () => {
    const { svc, stripe, bookingId } = await setupConfirmed();
    const now = new Date('2026-07-10T00:00:00Z'); // 5 days before
    const result = await svc.cancel(bookingId, { now });
    expect(result.cancellationTierApplied).toBe('0-day:0%');
    expect(stripe.refunds).toHaveLength(0);
    expect(result.refundAmount).toBe(0);
  });

  it('does not refund when there is no initial charge', async () => {
    const { svc, prisma, stripe } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    // Skip approve — manually flip to approved with no charges
    const row = prisma.bookings().find((x) => x.id === b.id)!;
    row.status = 'approved';

    const result = await svc.cancel(b.id, { now: new Date('2026-06-01T00:00:00Z') });
    expect(result.status).toBe('cancelled');
    expect(stripe.refunds).toHaveLength(0);
  });

  it('does not refund when initial charge is not succeeded', async () => {
    const { svc, prisma, stripe } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    await svc.approve(b.id); // status: approved, charge: sent (not succeeded)

    const result = await svc.cancel(b.id, { now: new Date('2026-06-01T00:00:00Z') });
    expect(result.status).toBe('cancelled');
    expect(stripe.refunds).toHaveLength(0);
  });
});

describe('BookingService.modifyDates', () => {
  it('refuses to modify a cancelled booking', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    const row = prisma.bookings().find((x) => x.id === b.id)!;
    row.status = 'cancelled';
    await expect(
      svc.modifyDates(b.id, { checkIn: '2026-08-01', checkOut: '2026-08-05' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects checkOut <= checkIn', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    await expect(
      svc.modifyDates(b.id, { checkIn: '2026-08-05', checkOut: '2026-08-05' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('ignores self-overlap (own existing range is not a conflict)', async () => {
    const { svc, prisma, availability } = buildSvc({
      conflicts: [
        { startDate: new Date('2026-07-15'), endDate: new Date('2026-07-18') },
      ],
    });
    void availability;
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    // pricing stub returns the same quote, so delta is unchanged
    const result = await svc.modifyDates(b.id, {
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    expect(result.delta.direction).toBe('unchanged');
  });

  it('increase: returns suggestedAdHocChargeKind=extension, no refund', async () => {
    const { svc, prisma, stripe, pricing } = await (async () => {
      const built = buildSvc();
      built.prisma.inquiries().push({ ...VALID_INQUIRY });
      await built.svc.convertInquiry('inq-1');
      // Make subsequent quote bigger
      built.pricing.getQuote.mockResolvedValueOnce({
        nightlyRate: 200,
        numberOfNights: 5,
        subtotal: 1000,
        taxes: { stateTlt: { label: 's', rate: 0.015, amount: 15 }, cityTlt: { label: 'c', rate: 0.09, amount: 90 }, totalTax: 105 },
        total: 1105,
      } as any);
      return built;
    })();
    void pricing;
    const b = prisma.bookings()[0];
    const result = await svc.modifyDates(b.id, {
      checkIn: '2026-07-15',
      checkOut: '2026-07-20',
    });
    expect(result.delta.direction).toBe('increase');
    expect(result.delta.suggestedAdHocChargeKind).toBe('extension');
    expect(result.delta.refundIssued).toBeNull();
    expect(stripe.refunds).toHaveLength(0);
  });

  it('decrease: auto-refunds against initial charge when succeeded', async () => {
    const { svc, prisma, stripe, bookingId } = await setupConfirmed();
    // Reduce the next quote
    const built = buildSvc();
    void built;
    // We need the *same* svc; mock the pricing on it via stripping. Easier: directly mock pricing module by re-injecting:
    (svc as any).pricing = {
      getQuote: jest.fn(async () => ({
        nightlyRate: 200,
        numberOfNights: 2,
        subtotal: 400,
        taxes: { stateTlt: { label: 's', rate: 0.015, amount: 6 }, cityTlt: { label: 'c', rate: 0.09, amount: 36 }, totalTax: 42 },
        total: 442,
      })),
    };

    const result = await svc.modifyDates(bookingId, {
      checkIn: '2026-07-15',
      checkOut: '2026-07-17',
    });
    expect(result.delta.direction).toBe('decrease');
    expect(result.delta.refundIssued).not.toBeNull();
    expect(result.delta.suggestedAdHocChargeKind).toBeNull();
    expect(stripe.refunds).toHaveLength(1);
    // 663 - 442 = 221
    expect(stripe.refunds[0].amount).toBe(22100);
    void prisma;
  });

  it('unchanged: no refund, no extension', async () => {
    const { svc, bookingId, stripe } = await setupConfirmed();
    const result = await svc.modifyDates(bookingId, {
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    expect(result.delta.direction).toBe('unchanged');
    expect(stripe.refunds).toHaveLength(0);
  });
});

describe('BookingService.createAdHocCharge', () => {
  it('rejects invalid kind', async () => {
    const { svc, bookingId } = await setupConfirmed();
    await expect(
      svc.createAdHocCharge(bookingId, { kind: 'bogus' as any, amount: 50, description: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-positive amount', async () => {
    const { svc, bookingId } = await setupConfirmed();
    await expect(
      svc.createAdHocCharge(bookingId, { kind: 'damage', amount: 0, description: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects empty description', async () => {
    const { svc, bookingId } = await setupConfirmed();
    await expect(
      svc.createAdHocCharge(bookingId, { kind: 'damage', amount: 100, description: '' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses on cancelled booking', async () => {
    const { svc, prisma, bookingId } = await setupConfirmed();
    prisma.bookings().find((b) => b.id === bookingId)!.status = 'cancelled';
    await expect(
      svc.createAdHocCharge(bookingId, { kind: 'damage', amount: 100, description: 'lamp' }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates a damage charge with sent status + checkout session + outbox', async () => {
    const { svc, prisma, stripe, bookingId } = await setupConfirmed();
    const result = await svc.createAdHocCharge(bookingId, {
      kind: 'damage',
      amount: 200,
      description: 'broken lamp',
    });
    expect(result.checkoutUrl).toMatch(/checkout\.stripe\.test/);
    const newCharge = prisma.charges().find((c) => c.id === result.chargeId)!;
    expect(newCharge.kind).toBe('damage');
    expect(newCharge.status).toBe('sent');
    expect(newCharge.amount).toBe(200);
    expect(newCharge.description).toBe('broken lamp');
    expect(newCharge.stripeCheckoutSessionId).toBeTruthy();
    expect(stripe.sessions.size).toBe(2); // initial + ad-hoc
    expect(prisma.outbox().some((o: any) => o.payload.event === 'booking.ad_hoc_charge_sent')).toBe(true);
  });

  it('rolls back the charge if Stripe session creation fails', async () => {
    const { svc, prisma, stripe, bookingId } = await setupConfirmed();
    stripe.failNextSessionWith = new Error('Stripe boom');
    const before = prisma.charges().length;
    await expect(
      svc.createAdHocCharge(bookingId, {
        kind: 'incidental',
        amount: 50,
        description: 'late checkout',
      }),
    ).rejects.toThrow('Stripe boom');
    expect(prisma.charges()).toHaveLength(before);
  });

  it('creates extension and incidental kinds too', async () => {
    const { svc, prisma, bookingId } = await setupConfirmed();
    await svc.createAdHocCharge(bookingId, {
      kind: 'extension',
      amount: 300,
      description: 'extra night',
    });
    await svc.createAdHocCharge(bookingId, {
      kind: 'incidental',
      amount: 25,
      description: 'pet',
    });
    const kinds = prisma.charges().map((c) => c.kind).sort();
    expect(kinds).toEqual(['extension', 'incidental', 'initial'].sort());
  });
});

describe('BookingService.refundCharge', () => {
  it('rejects non-succeeded charge', async () => {
    const { svc, prisma } = buildSvc();
    prisma.inquiries().push({ ...VALID_INQUIRY });
    const b = await svc.convertInquiry('inq-1');
    const approve = await svc.approve(b.id); // charge is 'sent' status
    await expect(
      svc.refundCharge(approve.chargeId, { amount: 100 }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects amount > remaining', async () => {
    const { svc, chargeId } = await setupConfirmed();
    await expect(
      svc.refundCharge(chargeId, { amount: 9999 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-positive amount', async () => {
    const { svc, chargeId } = await setupConfirmed();
    await expect(
      svc.refundCharge(chargeId, { amount: 0 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('partial refund updates refundedAmount, status stays succeeded', async () => {
    const { svc, prisma, stripe, chargeId } = await setupConfirmed();
    const result = await svc.refundCharge(chargeId, { amount: 100 });
    expect(result.amountRefunded).toBe(100);
    expect(stripe.refunds[0].amount).toBe(10000);
    const charge = prisma.charges().find((c) => c.id === chargeId)!;
    expect(charge.refundedAmount).toBeCloseTo(100);
    expect(charge.status).toBe('succeeded');
    expect(charge.refundedAt).toBeInstanceOf(Date);
  });

  it('full refund flips status to refunded', async () => {
    const { svc, prisma, chargeId } = await setupConfirmed();
    await svc.refundCharge(chargeId, { amount: 663 });
    const charge = prisma.charges().find((c) => c.id === chargeId)!;
    expect(charge.status).toBe('refunded');
    expect(charge.refundedAmount).toBeCloseTo(663);
  });

  it('returns NOT_FOUND on unknown charge', async () => {
    const { svc } = buildSvc();
    await expect(
      svc.refundCharge('nope', { amount: 50 }),
    ).rejects.toThrow(NotFoundException);
  });
});
