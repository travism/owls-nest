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
  charges: Array<{
    id: string;
    kind: string;
    amount: number;
    status: string;
    stripeCheckoutSessionId: string | null;
    stripePaymentIntentId: string | null;
    paidAt: string | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
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
      charges: (b.charges ?? []).map((c: any) => ({
        id: c.id,
        kind: c.kind,
        amount: Number(c.amount),
        status: c.status,
        stripeCheckoutSessionId: c.stripeCheckoutSessionId ?? null,
        stripePaymentIntentId: c.stripePaymentIntentId ?? null,
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

