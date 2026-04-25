// AvailabilityService — central source of truth for "is this range bookable?"
//
// Sources of unavailability (combined):
//   1. Direct Bookings in active statuses (pending_approval, approved, confirmed, completed)
//   2. BlockedDate rows of any reason (manual_block, maintenance, ota_booking)
//
// Used by:
//   - GET /api/v1/availability (public booking calendar) — listUnavailableInRange()
//   - Booking approval (M7) — checkAvailability(checkIn, checkOut) for conflict detection
//
// Date semantics: half-open intervals [start, end). Two ranges
// [a_start, a_end) and [b_start, b_end) overlap iff a_start < b_end AND b_start < a_end.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UnavailableRange {
  startDate: Date;
  endDate: Date;
}

export interface AvailabilityCheck {
  available: boolean;
  conflicts: UnavailableRange[];
}

// Booking statuses that block dates from re-use. `pending_approval` is
// included because the owner may approve later; we want to hold the
// inventory in the meantime to avoid promising the same dates twice.
const BLOCKING_STATUSES = ['pending_approval', 'approved', 'confirmed', 'completed'];

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List every unavailable date range that overlaps the [from, to) window.
   * Used by the public booking calendar to render disabled dates.
   */
  async listUnavailableInRange(from: Date, to: Date): Promise<UnavailableRange[]> {
    if (to <= from) return [];

    const [bookings, blocks] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          status: { in: BLOCKING_STATUSES },
          checkIn: { lt: to },
          checkOut: { gt: from },
        },
        select: { checkIn: true, checkOut: true },
        orderBy: { checkIn: 'asc' },
      }),
      this.prisma.blockedDate.findMany({
        where: {
          startDate: { lt: to },
          endDate: { gt: from },
        },
        select: { startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    const ranges: UnavailableRange[] = [
      ...bookings.map((b) => ({ startDate: b.checkIn, endDate: b.checkOut })),
      ...blocks.map((b) => ({ startDate: b.startDate, endDate: b.endDate })),
    ];
    ranges.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return ranges;
  }

  /**
   * Check whether a specific [checkIn, checkOut) range is bookable.
   * Returns the list of conflicting ranges if not.
   */
  async checkAvailability(checkIn: Date, checkOut: Date): Promise<AvailabilityCheck> {
    const conflicts = await this.listUnavailableInRange(checkIn, checkOut);
    return { available: conflicts.length === 0, conflicts };
  }
}
