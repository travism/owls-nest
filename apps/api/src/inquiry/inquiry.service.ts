// InquiryService — handles the no-account inquiry capture flow.
//
// Flow:
//   - Guest submits an inquiry (name, email, phone, dates, message)
//   - Service writes Inquiry row + an Outbox row for the admin notification
//   - Admin sees it in the dashboard, can mark responded / close, or
//     convert to a booking request (M7)
//
// Inquiry status state machine:
//   new ──► responded ──► closed
//      ╲                ↗
//       ╰─► converted ─╯ (terminal once a booking exists)

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { InquiryCreate } from '@owlsnest/shared';
import { Prisma } from '@owlsnest/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BookingService } from '../booking/booking.service';

export type InquiryStatus = 'new' | 'responded' | 'converted' | 'closed';

const ALLOWED_TRANSITIONS: Record<InquiryStatus, InquiryStatus[]> = {
  new: ['responded', 'closed', 'converted'],
  responded: ['closed', 'converted'],
  // 'converted' and 'closed' are terminal
  converted: [],
  closed: [],
};

@Injectable()
export class InquiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingService,
  ) {}

  /**
   * Public submission. Always returns a row (we don't expose duplicate
   * detection or rate limits to the caller — those are handled by the
   * global throttler).
   */
  async create(input: InquiryCreate) {
    const inquiry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inquiry.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          checkIn: new Date(input.checkIn),
          checkOut: new Date(input.checkOut),
          message: input.message ?? null,
          status: 'new',
        },
      });

      // Outbox row — admin notification. Drained by OutboxDrainService (M9).
      await tx.outbox.create({
        data: {
          jobName: 'admin-notification',
          payload: {
            event: 'inquiry.new',
            inquiryId: created.id,
            guestName: created.name,
            guestEmail: created.email,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            message: created.message,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `inquiry.new:${created.id}`,
        },
      });

      // Guest acknowledgement — drained by OutboxDrainService (M9).
      await tx.outbox.create({
        data: {
          jobName: 'guest-notification',
          payload: {
            event: 'inquiry.acknowledged',
            inquiryId: created.id,
            guestName: created.name,
            guestEmail: created.email,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `inquiry.acknowledged:${created.id}`,
        },
      });

      return created;
    });

    return this.serialize(inquiry);
  }

  async list(opts: { status?: InquiryStatus } = {}) {
    const rows = await this.prisma.inquiry.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.serialize(r));
  }

  async getById(id: string) {
    const row = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Inquiry not found.' });
    }
    return this.serialize(row);
  }

  async transition(id: string, next: InquiryStatus) {
    const existing = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Inquiry not found.' });
    }
    const allowed = ALLOWED_TRANSITIONS[existing.status as InquiryStatus] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `Cannot transition inquiry from ${existing.status} to ${next}.`,
        details: { from: existing.status, to: next, allowed },
      });
    }
    const updated = await this.prisma.inquiry.update({
      where: { id },
      data: { status: next },
    });
    return this.serialize(updated);
  }

  /**
   * Convert an inquiry → booking-request placeholder. Records the link via
   * `convertedBookingId`. Actual Booking row creation lands in M7 — for now
   * the conversion just stamps the inquiry as `converted` so the admin can
   * stop seeing it in the active queue.
   */
  async convert(id: string) {
    // Delegates to BookingService.convertInquiry which:
    //   - validates inquiry state (throws CONFLICT / VALIDATION_FAILED here too)
    //   - upserts a Guest record by email
    //   - creates a Booking row in pending_approval with current pricing
    //   - stamps the inquiry as 'converted' with convertedBookingId set
    // Then we refetch and return the inquiry in its now-converted state, so
    // the response shape stays compatible with M6 callers.
    await this.bookings.convertInquiry(id);
    const updated = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!updated) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Inquiry not found.' });
    }
    return this.serialize(updated);
  }

  private serialize(i: any) {
    return {
      id: i.id,
      name: i.name,
      email: i.email,
      phone: i.phone ?? null,
      checkIn: toISODate(i.checkIn),
      checkOut: toISODate(i.checkOut),
      message: i.message ?? null,
      status: i.status as InquiryStatus,
      convertedBookingId: i.convertedBookingId ?? null,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }
}

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
