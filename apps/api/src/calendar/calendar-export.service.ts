// CalendarExportService — generates the public iCal feed consumed by OTAs.
//
// Inclusion rules (locked in D-015 + calendar-sync-plan.md §3.2):
//
//   ✅ Booking where source='direct' AND status IN (approved, confirmed, completed)
//   ✅ BlockedDate where reason IN (manual_block, maintenance)
//   ❌ Booking with non-direct source — never (would reflect OTA back to itself)
//   ❌ BlockedDate where reason='ota_booking' — never (same reason)
//   ❌ Booking in inquiry / pending_approval / cancelled status
//
// OTAs cross-sync among themselves; our feed only carries direct bookings +
// manual blocks they have no other way of learning about.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildVCalendar, buildVEvent } from './ical';

@Injectable()
export class CalendarExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateExportFeed(): Promise<string> {
    const [bookings, blocks] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          source: 'direct',
          status: { in: ['approved', 'confirmed', 'completed'] },
        },
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.blockedDate.findMany({
        where: {
          reason: { in: ['manual_block', 'maintenance'] },
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          reason: true,
          sourceSummary: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const events: string[] = [];

    for (const b of bookings) {
      events.push(
        buildVEvent({
          uid: `booking-${b.id}@owlsnest.com`,
          dtstart: b.checkIn,
          dtend: b.checkOut,
          summary: 'Reserved',
          description: "Direct booking — The Owl's Nest",
          dtstamp: b.updatedAt ?? b.createdAt,
        }),
      );
    }

    for (const block of blocks) {
      const description =
        block.reason === 'maintenance'
          ? 'Maintenance block'
          : (block.sourceSummary ?? 'Manually blocked');
      events.push(
        buildVEvent({
          uid: `block-${block.id}@owlsnest.com`,
          dtstart: block.startDate,
          dtend: block.endDate,
          summary: 'Not available',
          description,
          dtstamp: block.updatedAt ?? block.createdAt,
        }),
      );
    }

    return buildVCalendar(events);
  }
}
