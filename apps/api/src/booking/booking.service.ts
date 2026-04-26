// BookingService — central business logic for the request-to-book flow.
//
// Lifecycle (M7 scope):
//   inquiry → admin convert → Booking(pending_approval)
//                          → admin approve → Booking(approved) + initial BookingCharge
//                          → guest pays via Stripe Checkout
//                          → webhook → Booking(confirmed) + Charge(succeeded)
//
// M8 will add: decline, cancel, modify dates, ad-hoc charges, refunds.

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@owlsnest/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { AvailabilityService } from '../calendar/availability.service';
import {
  STRIPE_ADAPTER,
  type StripeAdapter,
} from '../integrations/stripe/stripe.types';
import {
  resolveCancellation,
  calculateRefundCents,
  type CancellationPolicy,
} from './cancellation-policy';

export type AdHocChargeKind = 'extension' | 'damage' | 'incidental';

export type BookingStatus =
  | 'inquiry'
  | 'pending_approval'
  | 'approved'
  | 'confirmed'
  | 'cancelled'
  | 'completed';

export interface ApprovalResult {
  booking: SerializedBooking;
  checkoutUrl: string;
  chargeId: string;
}

export interface SerializedBooking {
  id: string;
  status: BookingStatus;
  source: string;
  guestId: string | null;
  guest: { id: string; name: string; email: string; phone: string | null } | null;
  checkIn: string;
  checkOut: string;
  numNights: number;
  numGuests: number;
  nightlyRate: number;
  subtotal: number;
  totalTaxAmount: number;
  totalWithTax: number;
  stripeCustomerId: string | null;
  cancellationTierApplied: string | null;
  refundAmount: number | null;
  cancelledAt: string | null;
  charges: Array<{
    id: string;
    kind: string;
    amount: number;
    status: string;
    description: string | null;
    stripeCheckoutSessionId: string | null;
    stripePaymentIntentId: string | null;
    refundedAmount: number;
    refundedAt: string | null;
    paidAt: string | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ModifyDatesResult {
  booking: SerializedBooking;
  delta: {
    direction: 'increase' | 'decrease' | 'unchanged';
    amount: number;
    suggestedAdHocChargeKind: AdHocChargeKind | null;
    refundIssued: { chargeId: string; amount: number } | null;
  };
}

export interface AdHocChargeResult {
  booking: SerializedBooking;
  chargeId: string;
  checkoutUrl: string;
}

export interface RefundResult {
  booking: SerializedBooking;
  chargeId: string;
  amountRefunded: number;
}

const SUCCESS_URL_DEFAULT = 'http://localhost:4321/book/thanks';
const CANCEL_URL_DEFAULT = 'http://localhost:4321/book';

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly availability: AvailabilityService,
    @Inject(STRIPE_ADAPTER) private readonly stripe: StripeAdapter,
  ) {}

  /**
   * Convert an Inquiry to a Booking. Creates (or reuses by email) a Guest,
   * creates a Booking row in pending_approval status with current pricing,
   * and stamps the Inquiry as `converted` with a back-reference.
   *
   * Conflict checking is deferred to approve() — admin can convert even if
   * dates conflict; they'll see the conflict at approval time.
   */
  async convertInquiry(inquiryId: string): Promise<SerializedBooking> {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
    });
    if (!inquiry) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Inquiry not found.' });
    }
    if (inquiry.status === 'converted') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Inquiry already converted.',
      });
    }
    if (inquiry.status === 'closed') {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Closed inquiries cannot be converted.',
      });
    }

    const property = await this.prisma.property.findFirst();
    if (!property) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Property not configured.',
      });
    }

    const quote = await this.pricing.getQuote(
      inquiry.checkIn,
      inquiry.checkOut,
    );

    const booking = await this.prisma.$transaction(async (tx) => {
      // Find or create the Guest record by email.
      const guest = await tx.guest.upsert({
        where: { email: inquiry.email },
        update: {
          // Keep the latest contact info — guest may have updated since their
          // last inquiry.
          name: inquiry.name,
          phone: inquiry.phone ?? undefined,
        },
        create: {
          name: inquiry.name,
          email: inquiry.email,
          phone: inquiry.phone,
        },
      });

      const created = await tx.booking.create({
        data: {
          propertyId: property.id,
          guestId: guest.id,
          checkIn: inquiry.checkIn,
          checkOut: inquiry.checkOut,
          // M6's schema defaulted numGuests to 1 when not asked; PRD §4.1 lets
          // the inquiry skip this. Default to 1 here; admin can edit later.
          numGuests: 1,
          status: 'pending_approval',
          source: 'direct',
          nightlyRate: quote.nightlyRate,
          numNights: quote.numberOfNights,
          subtotal: quote.subtotal,
          stateTltAmount: quote.taxes.stateTlt.amount,
          cityTltAmount: quote.taxes.cityTlt.amount,
          totalTaxAmount: quote.taxes.totalTax,
        },
      });

      await tx.inquiry.update({
        where: { id: inquiry.id },
        data: { status: 'converted', convertedBookingId: created.id },
      });

      return created;
    });

    return this.loadAndSerialize(booking.id);
  }

  /**
   * Approve a pending booking: check conflicts, create or reuse a Stripe
   * Customer, create the initial BookingCharge, open a Checkout Session,
   * and write an Outbox row to send the payment link to the guest.
   */
  async approve(bookingId: string): Promise<ApprovalResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true, charges: true },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status !== 'pending_approval') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Booking is in ${booking.status}; only pending_approval can be approved.`,
        details: { currentStatus: booking.status },
      });
    }
    if (!booking.guest) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Booking has no guest record — cannot approve.',
      });
    }

    // Conflict detection — refuse if another booking/block now covers the dates.
    const conflicts = await this.availability.listUnavailableInRange(
      booking.checkIn,
      booking.checkOut,
    );
    // Filter out this booking's own checkin/checkout — pending_approval rows
    // appear in the unavailability set per AvailabilityService.
    const realConflicts = conflicts.filter(
      (c) =>
        !(
          c.startDate.getTime() === booking.checkIn.getTime() &&
          c.endDate.getTime() === booking.checkOut.getTime()
        ),
    );
    if (realConflicts.length > 0) {
      throw new ConflictException({
        code: 'DOUBLE_BOOKING',
        message: 'Dates conflict with another booking or block.',
        details: { conflicts: realConflicts },
      });
    }

    // Reuse Stripe Customer if we already have one; otherwise create.
    let customerId = booking.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.createCustomer({
        email: booking.guest.email,
        name: booking.guest.name,
        phone: booking.guest.phone ?? undefined,
      });
      customerId = customer.id;
    }

    const totalCents = Math.round(
      (Number(booking.subtotal) + Number(booking.totalTaxAmount)) * 100,
    );

    // Create the BookingCharge first (status pending) so the Stripe
    // metadata can reference its UUID.
    const charge = await this.prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        kind: 'initial',
        amount: Number(booking.subtotal) + Number(booking.totalTaxAmount),
        currency: 'usd',
        description: `The Owl's Nest — ${formatRange(booking.checkIn, booking.checkOut)}`,
        status: 'pending',
      },
    });

    let session;
    try {
      session = await this.stripe.createCheckoutSession({
        customerId,
        amountCents: totalCents,
        currency: 'usd',
        description: `The Owl's Nest stay (${formatRange(booking.checkIn, booking.checkOut)})`,
        metadata: {
          bookingId: booking.id,
          chargeId: charge.id,
        },
        successUrl: process.env.STRIPE_SUCCESS_URL ?? SUCCESS_URL_DEFAULT,
        cancelUrl: process.env.STRIPE_CANCEL_URL ?? CANCEL_URL_DEFAULT,
      });
    } catch (err) {
      // Roll back the charge so we don't end up with an orphan pending row.
      await this.prisma.bookingCharge.delete({ where: { id: charge.id } });
      throw err;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingCharge.update({
        where: { id: charge.id },
        data: {
          status: 'sent',
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.paymentIntentId,
        },
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'approved',
          stripeCustomerId: customerId,
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.approved',
            bookingId: booking.id,
            chargeId: charge.id,
            checkoutUrl: session.url,
            guestEmail: booking.guest!.email,
            guestPhone: booking.guest!.phone,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.approved:${booking.id}:${charge.id}`,
        },
      });
    });

    const serialized = await this.loadAndSerialize(booking.id);
    return { booking: serialized, checkoutUrl: session.url, chargeId: charge.id };
  }

  async list(opts: { status?: BookingStatus } = {}): Promise<SerializedBooking[]> {
    const rows = await this.prisma.booking.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      include: { guest: true, charges: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ checkIn: 'asc' }],
    });
    return rows.map((r) => this.serialize(r));
  }

  async getById(id: string): Promise<SerializedBooking> {
    return this.loadAndSerialize(id);
  }

  /**
   * Webhook callback: a Stripe checkout.session.completed event tied to one
   * of our BookingCharges has arrived. Flip the charge to succeeded, fetch
   * the fee, and confirm the Booking.
   */
  async handleCheckoutSucceeded(params: {
    sessionId: string;
    paymentIntentId: string | null;
  }): Promise<{ chargeId: string; bookingId: string } | null> {
    const charge = await this.prisma.bookingCharge.findUnique({
      where: { stripeCheckoutSessionId: params.sessionId },
      include: { booking: true },
    });
    if (!charge) return null;
    if (charge.status === 'succeeded') {
      // Already processed. Webhook idempotency is at the WebhookEvent level
      // but a guard here defends against any path that re-enters this method.
      return { chargeId: charge.id, bookingId: charge.bookingId };
    }

    let feeCents = 0;
    let paymentIntentId = params.paymentIntentId ?? charge.stripePaymentIntentId;
    if (paymentIntentId) {
      try {
        const pi = await this.stripe.retrievePaymentIntent(paymentIntentId);
        if (pi.latestChargeId) {
          // Stripe's BalanceTransaction is keyed off the charge, but for our
          // fake we accept either id; for real Stripe we'd need to retrieve
          // the Charge first to get its balance_transaction id. Simpler path
          // for now: try the latestChargeId directly.
          const bt = await this.stripe.retrieveBalanceTransaction(pi.latestChargeId);
          feeCents = bt.fee;
        }
      } catch {
        // Don't block confirmation on fee lookup failure.
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingCharge.update({
        where: { id: charge.id },
        data: {
          status: 'succeeded',
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId ?? charge.stripePaymentIntentId,
          stripeFee: feeCents / 100,
        },
      });
      await tx.booking.update({
        where: { id: charge.bookingId },
        data: { status: 'confirmed' },
      });
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.confirmed',
            bookingId: charge.bookingId,
            chargeId: charge.id,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.confirmed:${charge.id}`,
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'rebuild-site',
          payload: {
            reason: 'booking.confirmed',
            bookingId: charge.bookingId,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `rebuild-site:booking.confirmed:${charge.bookingId}`,
        },
      });
    });

    return { chargeId: charge.id, bookingId: charge.bookingId };
  }

  // ---------------------------------------------------------------
  // M8 actions
  // ---------------------------------------------------------------

  /**
   * Decline a pending_approval booking. Marks it cancelled with a special
   * cancellationTierApplied='declined' marker. Writes guest-notification
   * outbox row.
   */
  async decline(
    bookingId: string,
    opts: { reason?: string } = {},
  ): Promise<SerializedBooking> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status !== 'pending_approval') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Booking is in ${booking.status}; only pending_approval can be declined.`,
        details: { currentStatus: booking.status },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'cancelled',
          cancellationTierApplied: 'declined',
          refundAmount: 0,
          cancelledAt: new Date(),
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.declined',
            bookingId: booking.id,
            reason: opts.reason ?? null,
            guestEmail: booking.guest?.email ?? null,
            guestPhone: booking.guest?.phone ?? null,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.declined:${booking.id}`,
        },
      });
    });

    return this.loadAndSerialize(booking.id);
  }

  /**
   * Cancel an approved or confirmed booking. Resolves the cancellation tier
   * against the property's policy and the booking's check-in date, and (if a
   * succeeded initial charge exists) auto-refunds via Stripe.
   */
  async cancel(
    bookingId: string,
    opts: { reason?: string; now?: Date } = {},
  ): Promise<SerializedBooking> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { property: true, guest: true, charges: true },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status !== 'approved' && booking.status !== 'confirmed') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Booking is in ${booking.status}; only approved/confirmed can be cancelled.`,
        details: { currentStatus: booking.status },
      });
    }

    const policy = (booking as any).property?.cancellationPolicy as
      | CancellationPolicy
      | undefined;
    if (!policy) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Property has no cancellation policy configured.',
      });
    }
    const now = opts.now ?? new Date();
    const resolved = resolveCancellation(policy, booking.checkIn, now);
    const tierLabel = `${resolved.tier.daysBeforeCheckin}-day:${resolved.tier.refundPercent}%`;

    const initial = (booking.charges ?? []).find(
      (c: any) => c.kind === 'initial',
    );
    let refundAmountDollars = 0;
    let refundedChargeUpdate: { id: string; refundedAmount: number; fullyRefunded: boolean } | null = null;
    if (
      initial &&
      initial.status === 'succeeded' &&
      initial.stripePaymentIntentId &&
      resolved.tier.refundPercent > 0
    ) {
      const refundCents = calculateRefundCents(
        Number(initial.amount),
        Number(initial.refundedAmount ?? 0),
        resolved.tier.refundPercent,
      );
      if (refundCents > 0) {
        await this.stripe.createRefund({
          paymentIntentId: initial.stripePaymentIntentId,
          amountCents: refundCents,
          reason: 'requested_by_customer',
          metadata: { bookingId: booking.id, chargeId: initial.id },
        });
        refundAmountDollars = refundCents / 100;
        const newRefunded = Number(initial.refundedAmount ?? 0) + refundAmountDollars;
        refundedChargeUpdate = {
          id: initial.id,
          refundedAmount: newRefunded,
          fullyRefunded: newRefunded + 0.001 >= Number(initial.amount),
        };
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (refundedChargeUpdate) {
        await tx.bookingCharge.update({
          where: { id: refundedChargeUpdate.id },
          data: {
            refundedAmount: refundedChargeUpdate.refundedAmount,
            refundedAt: new Date(),
            ...(refundedChargeUpdate.fullyRefunded ? { status: 'refunded' } : {}),
          },
        });
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'cancelled',
          cancellationTierApplied: tierLabel,
          refundAmount: refundAmountDollars,
          cancelledAt: new Date(),
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.cancelled',
            bookingId: booking.id,
            tier: tierLabel,
            refundAmount: refundAmountDollars,
            reason: opts.reason ?? null,
            guestEmail: booking.guest?.email ?? null,
            guestPhone: booking.guest?.phone ?? null,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.cancelled:${booking.id}`,
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'rebuild-site',
          payload: {
            reason: 'booking.cancelled',
            bookingId: booking.id,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `rebuild-site:booking.cancelled:${booking.id}`,
        },
      });
    });

    return this.loadAndSerialize(booking.id);
  }

  /**
   * Modify a booking's check-in/check-out. Re-quotes pricing; if the new
   * total is higher, returns a suggestion to create an extension charge for
   * the delta. If lower, auto-refunds against the initial charge.
   */
  async modifyDates(
    bookingId: string,
    input: { checkIn: string; checkOut: string },
  ): Promise<ModifyDatesResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true, charges: true },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Booking is in ${booking.status}; cannot modify dates.`,
        details: { currentStatus: booking.status },
      });
    }

    const newCheckIn = parseISODate(input.checkIn);
    const newCheckOut = parseISODate(input.checkOut);
    if (newCheckOut.getTime() <= newCheckIn.getTime()) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'checkOut must be after checkIn.',
      });
    }

    // Conflict detection across the new range; ignore the booking's own
    // existing range (same logic as approve()).
    const conflicts = await this.availability.listUnavailableInRange(
      newCheckIn,
      newCheckOut,
    );
    const realConflicts = conflicts.filter(
      (c) =>
        !(
          c.startDate.getTime() === booking.checkIn.getTime() &&
          c.endDate.getTime() === booking.checkOut.getTime()
        ),
    );
    if (realConflicts.length > 0) {
      throw new ConflictException({
        code: 'DOUBLE_BOOKING',
        message: 'New dates conflict with another booking or block.',
        details: { conflicts: realConflicts },
      });
    }

    const quote = await this.pricing.getQuote(newCheckIn, newCheckOut);
    const newTotal = Math.round((quote.subtotal + quote.taxes.totalTax) * 100) / 100;
    const oldTotal = Math.round(
      (Number(booking.subtotal) + Number(booking.totalTaxAmount)) * 100,
    ) / 100;
    const deltaCents = Math.round(newTotal * 100) - Math.round(oldTotal * 100);
    const deltaDollars = deltaCents / 100;
    const direction: 'increase' | 'decrease' | 'unchanged' =
      deltaCents > 0 ? 'increase' : deltaCents < 0 ? 'decrease' : 'unchanged';

    let refundIssued: { chargeId: string; amount: number } | null = null;
    let initialChargeUpdate: { id: string; refundedAmount: number } | null = null;
    if (deltaCents < 0) {
      const initial = (booking.charges ?? []).find(
        (c: any) => c.kind === 'initial',
      );
      if (
        initial &&
        initial.status === 'succeeded' &&
        initial.stripePaymentIntentId
      ) {
        const refundCents = Math.abs(deltaCents);
        await this.stripe.createRefund({
          paymentIntentId: initial.stripePaymentIntentId,
          amountCents: refundCents,
          reason: 'requested_by_customer',
          metadata: { bookingId: booking.id, chargeId: initial.id, kind: 'modify_dates' },
        });
        refundIssued = { chargeId: initial.id, amount: refundCents / 100 };
        initialChargeUpdate = {
          id: initial.id,
          refundedAmount:
            Number(initial.refundedAmount ?? 0) + refundCents / 100,
        };
      }
    }

    const ts = Date.now();
    await this.prisma.$transaction(async (tx) => {
      if (initialChargeUpdate) {
        await tx.bookingCharge.update({
          where: { id: initialChargeUpdate.id },
          data: {
            refundedAmount: initialChargeUpdate.refundedAmount,
            refundedAt: new Date(),
          },
        });
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          numNights: quote.numberOfNights,
          nightlyRate: quote.nightlyRate,
          subtotal: quote.subtotal,
          stateTltAmount: quote.taxes.stateTlt.amount,
          cityTltAmount: quote.taxes.cityTlt.amount,
          totalTaxAmount: quote.taxes.totalTax,
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.dates_modified',
            bookingId: booking.id,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            delta: deltaDollars,
            direction,
            refundIssued,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.dates_modified:${booking.id}:${ts}`,
        },
      });
    });

    const serialized = await this.loadAndSerialize(booking.id);
    return {
      booking: serialized,
      delta: {
        direction,
        amount: Math.abs(deltaDollars),
        suggestedAdHocChargeKind: direction === 'increase' ? 'extension' : null,
        refundIssued,
      },
    };
  }

  /**
   * Create an ad-hoc charge (extension/damage/incidental) on an existing
   * booking. Creates a Stripe Checkout Session and writes an outbox row to
   * deliver the link to the guest.
   */
  async createAdHocCharge(
    bookingId: string,
    input: { kind: AdHocChargeKind; amount: number; description: string },
  ): Promise<AdHocChargeResult> {
    if (!['extension', 'damage', 'incidental'].includes(input.kind)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'kind must be extension|damage|incidental.',
      });
    }
    if (
      typeof input.amount !== 'number' ||
      !isFinite(input.amount) ||
      input.amount <= 0 ||
      input.amount > 50000
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'amount must be a positive number ≤ 50000.',
      });
    }
    if (!input.description || input.description.trim().length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'description is required.',
      });
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status === 'cancelled') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Cannot add charges to a cancelled booking.',
      });
    }
    if (!booking.guest) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Booking has no guest record.',
      });
    }

    let customerId = booking.stripeCustomerId;
    let createdNewCustomer = false;
    if (!customerId) {
      const customer = await this.stripe.createCustomer({
        email: booking.guest.email,
        name: booking.guest.name,
        phone: booking.guest.phone ?? undefined,
      });
      customerId = customer.id;
      createdNewCustomer = true;
    }

    const charge = await this.prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        kind: input.kind,
        amount: input.amount,
        currency: 'usd',
        description: input.description,
        status: 'pending',
      },
    });

    const totalCents = Math.round(input.amount * 100);
    let session;
    try {
      session = await this.stripe.createCheckoutSession({
        customerId,
        amountCents: totalCents,
        currency: 'usd',
        description: `${input.kind} charge — ${input.description}`,
        metadata: { bookingId: booking.id, chargeId: charge.id },
        successUrl: process.env.STRIPE_SUCCESS_URL ?? SUCCESS_URL_DEFAULT,
        cancelUrl: process.env.STRIPE_CANCEL_URL ?? CANCEL_URL_DEFAULT,
      });
    } catch (err) {
      await this.prisma.bookingCharge.delete({ where: { id: charge.id } });
      throw err;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingCharge.update({
        where: { id: charge.id },
        data: {
          status: 'sent',
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.paymentIntentId,
        },
      });
      if (createdNewCustomer) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { stripeCustomerId: customerId },
        });
      }
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.ad_hoc_charge_sent',
            bookingId: booking.id,
            chargeId: charge.id,
            kind: input.kind,
            amount: input.amount,
            description: input.description,
            checkoutUrl: session.url,
            guestEmail: booking.guest!.email,
            guestPhone: booking.guest!.phone,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.ad_hoc:${charge.id}`,
        },
      });
    });

    const serialized = await this.loadAndSerialize(booking.id);
    return { booking: serialized, chargeId: charge.id, checkoutUrl: session.url };
  }

  /**
   * Refund part or all of an already-succeeded charge. Bumps refundedAmount
   * and flips status to 'refunded' when fully refunded.
   */
  async refundCharge(
    chargeId: string,
    input: { amount: number; reason?: string },
  ): Promise<RefundResult> {
    if (
      typeof input.amount !== 'number' ||
      !isFinite(input.amount) ||
      input.amount <= 0
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'amount must be positive.',
      });
    }
    const charge = await this.prisma.bookingCharge.findUnique({
      where: { id: chargeId },
      include: { booking: true },
    });
    if (!charge) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Charge not found.' });
    }
    if (charge.status !== 'succeeded' && charge.status !== 'refunded') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Charge is in ${charge.status}; only succeeded charges can be refunded.`,
      });
    }
    if (!charge.stripePaymentIntentId) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Charge has no Stripe PaymentIntent.',
      });
    }
    const remaining = Number(charge.amount) - Number(charge.refundedAmount ?? 0);
    if (input.amount > remaining + 0.001) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Refund exceeds remaining charge amount.',
        details: { remaining, requested: input.amount },
      });
    }

    const refundCents = Math.round(input.amount * 100);
    const refund = await this.stripe.createRefund({
      paymentIntentId: charge.stripePaymentIntentId,
      amountCents: refundCents,
      reason: input.reason ?? 'requested_by_customer',
      metadata: { chargeId: charge.id, bookingId: charge.bookingId },
    });

    const newRefunded = Number(charge.refundedAmount ?? 0) + input.amount;
    const fullyRefunded = newRefunded + 0.001 >= Number(charge.amount);

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingCharge.update({
        where: { id: charge.id },
        data: {
          refundedAmount: newRefunded,
          refundedAt: new Date(),
          ...(fullyRefunded ? { status: 'refunded' } : {}),
        },
      });
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'booking.charge_refunded',
            bookingId: charge.bookingId,
            chargeId: charge.id,
            amount: input.amount,
            reason: input.reason ?? null,
            refundId: refund.id,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `booking.charge_refunded:${charge.id}:${refund.id}`,
        },
      });
    });

    const serialized = await this.loadAndSerialize(charge.bookingId);
    return {
      booking: serialized,
      chargeId: charge.id,
      amountRefunded: input.amount,
    };
  }

  // ---------------------------------------------------------------
  // Internal serialization
  // ---------------------------------------------------------------

  private async loadAndSerialize(id: string): Promise<SerializedBooking> {
    const row = await this.prisma.booking.findUnique({
      where: { id },
      include: { guest: true, charges: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    return this.serialize(row);
  }

  private serialize(b: any): SerializedBooking {
    const subtotal = Number(b.subtotal);
    const totalTaxAmount = Number(b.totalTaxAmount);
    return {
      id: b.id,
      status: b.status,
      source: b.source,
      guestId: b.guestId ?? null,
      guest: b.guest
        ? {
            id: b.guest.id,
            name: b.guest.name,
            email: b.guest.email,
            phone: b.guest.phone ?? null,
          }
        : null,
      checkIn: toISODate(b.checkIn),
      checkOut: toISODate(b.checkOut),
      numNights: b.numNights,
      numGuests: b.numGuests,
      nightlyRate: Number(b.nightlyRate),
      subtotal,
      totalTaxAmount,
      totalWithTax: subtotal + totalTaxAmount,
      stripeCustomerId: b.stripeCustomerId ?? null,
      cancellationTierApplied: b.cancellationTierApplied ?? null,
      refundAmount: b.refundAmount != null ? Number(b.refundAmount) : null,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      charges: (b.charges ?? []).map((c: any) => ({
        id: c.id,
        kind: c.kind,
        amount: Number(c.amount),
        status: c.status,
        description: c.description ?? null,
        stripeCheckoutSessionId: c.stripeCheckoutSessionId ?? null,
        stripePaymentIntentId: c.stripePaymentIntentId ?? null,
        refundedAmount: c.refundedAmount != null ? Number(c.refundedAmount) : 0,
        refundedAt: c.refundedAt?.toISOString() ?? null,
        paidAt: c.paidAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRange(checkIn: Date, checkOut: Date): string {
  return `${toISODate(checkIn)} → ${toISODate(checkOut)}`;
}

/**
 * Parse a YYYY-MM-DD string into a UTC midnight Date.
 * Throws BadRequestException on malformed input.
 */
function parseISODate(s: string): Date {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Date must be in YYYY-MM-DD format.',
    });
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (isNaN(d.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid date.',
    });
  }
  return d;
}

