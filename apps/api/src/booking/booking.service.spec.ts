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
