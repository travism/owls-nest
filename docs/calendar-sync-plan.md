# The Owl's Nest — iCal Calendar Sync Implementation Guide

**Supplements:** Platform PRD Section 5 (Calendar Sync)
**Version:** 1.0
**Date:** April 25, 2026
**Phase:** Phase 1 (Export) + Phase 2 (Import)

---

## 1. Overview

The Owl's Nest platform uses iCal (RFC 5545) for bidirectional calendar synchronization with OTA platforms. The platform is the **source of truth** for availability — it exports blocked dates to OTAs and imports OTA bookings to prevent double bookings.

iCal sync is date-only and availability-only. It does not transfer pricing, guest details, cancellation policies, or messaging. This is a fundamental limitation of the format and the reason the PRD uses a request-to-book flow (owner approval) as the primary double-booking safeguard.

### What Each Direction Does

| Direction | What Syncs | What Doesn't Sync |
|-----------|-----------|-------------------|
| **Export** (Platform → OTAs) | Blocked date ranges for direct bookings, manual blocks, maintenance blocks | Pricing, guest info, property details, minimum stays |
| **Import** (OTAs → Platform) | Booked date ranges from Airbnb, VRBO, etc. | Guest name, contact info, pricing, number of guests, booking status details |

### Platform Sync Behavior (What You Can't Control)

Each OTA controls how frequently it polls your export feed. You have no way to force an OTA to re-fetch your calendar — you can only ensure your feed is always current when they do.

| Platform | Polls Your Export Feed | Updates Its Own Export Feed |
|----------|----------------------|---------------------------|
| **Airbnb** | ~Every 2–3 hours (manual refresh available in host dashboard) | Near-immediately after booking confirmation |
| **VRBO** | ~Every 30 minutes | Near-immediately after booking confirmation |

**Your platform** controls how often it polls OTA feeds. The PRD default is every 15 minutes, which is aggressive enough to catch most bookings within a reasonable window while staying well under any rate-limiting thresholds.

---

## 2. iCal Format Reference

### 2.1 The Format

An iCal feed is a plain-text file (MIME type `text/calendar`, extension `.ics`) structured as a `VCALENDAR` object containing one or more `VEVENT` components. Each `VEVENT` represents a blocked date range.

For vacation rental calendar sync, events use **`VALUE=DATE`** (all-day events with no time component), where `DTSTART` is the check-in date and `DTEND` is the check-out date (exclusive — the guest is gone by this date).

### 2.2 Airbnb Export Format

Airbnb's iCal export includes more metadata than most platforms. Since December 2019, Airbnb has progressively reduced the data included in iCal feeds, but as of 2025–2026 their format still includes structured description fields. Here's the actual format:

```ics
BEGIN:VCALENDAR
PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.2.5//EN
CALSCALE:GREGORIAN
VERSION:2.0
BEGIN:VEVENT
DTEND;VALUE=DATE:20260718
DTSTART;VALUE=DATE:20260715
UID:a1b2c3d4-e5f6-7890-abcd-ef1234567890@airbnb.com
DESCRIPTION:CHECKIN: 15/07/2026\nCHECKOUT: 18/07/2026\nNIGHTS: 3\nPHONE: +1 555-123-4567\nEMAIL: guest@example.com\nPROPERTY: The Owl's Nest\nGUESTS: 2
SUMMARY:Jane Smith (HABCD1234)
LOCATION:The Owl's Nest
END:VEVENT
END:VCALENDAR
```

**Key fields in Airbnb VEVENT:**

| Field | Format | Notes |
|-------|--------|-------|
| `DTSTART;VALUE=DATE` | `YYYYMMDD` | Check-in date |
| `DTEND;VALUE=DATE` | `YYYYMMDD` | Check-out date (exclusive — guest departs this day) |
| `UID` | `uuid@airbnb.com` | Globally unique, stable across feed refreshes. Used to detect modifications and cancellations. |
| `SUMMARY` | `Guest Name (CONFIRMATION_CODE)` | Contains guest first/last name and Airbnb confirmation code in parentheses |
| `DESCRIPTION` | Key-value pairs separated by `\n` | Contains CHECKIN, CHECKOUT, NIGHTS, PHONE, EMAIL, PROPERTY, GUESTS. **Do not rely on this** — Airbnb has reduced this data before and may do so again. |
| `LOCATION` | Property name | Your listing name |

**Important Airbnb limitations:**
- Feed only includes bookings up to **365 days** in the future
- Pending bookings (awaiting host acceptance) **do** appear and block dates in the iCal feed
- Cancelled bookings are **removed** from the feed on the next refresh
- No pricing data whatsoever

### 2.3 VRBO Export Format

VRBO's iCal export is more minimal than Airbnb's. VRBO provides two export URL variants:

- **Standard URL** (includes tentative/pending reservations): `https://www.vrbo.com/icalendar/<token>.ics`
- **Non-tentative URL** (confirmed only): `https://www.vrbo.com/icalendar/<token>.ics?nonTentative`

**Use the standard URL** (without `?nonTentative`) to block dates as early as possible and reduce double-booking risk.

VRBO's VEVENT format is minimal:

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//vrbo.com//NONSGML Vrbo Calendar//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260715
DTEND;VALUE=DATE:20260718
UID:vrbo-reservation-abc123@vrbo.com
SUMMARY:Reserved
DTSTAMP:20260710T150000Z
END:VEVENT
END:VCALENDAR
```

**Key differences from Airbnb:**

| Field | VRBO Behavior |
|-------|--------------|
| `SUMMARY` | Typically just `"Reserved"` — no guest name or confirmation code |
| `DESCRIPTION` | Often absent or minimal — no structured guest data |
| `UID` | Platform-specific format, stable for the life of the reservation |
| Tentative bookings | Included by default; use `?nonTentative` to exclude |

### 2.4 Date Semantics — Critical Detail

Both platforms use `VALUE=DATE` (no time component). The date convention is:

- **`DTSTART`** = the day the guest checks in (this day is **blocked/unavailable**)
- **`DTEND`** = the day the guest checks out (this day is the **first available day**)

This matches RFC 5545's definition for all-day events where `DTEND` is exclusive. When storing blocked dates in PostgreSQL, store the range as `[DTSTART, DTEND)` — check-in through the night before check-out.

**Example:** A 3-night stay July 15–18 means:
- `DTSTART: 20260715` (guest arrives July 15)
- `DTEND: 20260718` (guest departs July 18 — July 18 is available for a new check-in)
- Blocked nights: July 15, 16, 17

---

## 3. Export Implementation (Platform → OTAs)

### 3.1 Feed Endpoint

The NestJS API serves a single iCal export feed at a stable, public URL. This URL is what you paste into Airbnb and VRBO's "import calendar" settings.

**Endpoint:** `GET /api/calendar/export.ics`

The feed should also be available at the vanity path configured via the Astro site or Cloudflare routing: `https://owlsnest.com/calendar.ics`

### 3.2 What to Include

The export feed must include every date range that should be blocked on external platforms:

| Source | Include? | SUMMARY Value |
|--------|----------|---------------|
| Confirmed direct bookings | Yes | `Reserved` |
| Approved (awaiting payment) direct bookings | Yes | `Reserved` |
| Manual blocks (owner-set) | Yes | `Not available` |
| Maintenance blocks | Yes | `Not available` |
| Imported OTA bookings | **No** — the OTA already knows about its own bookings | — |

**Do not re-export OTA bookings.** If Airbnb booking dates are re-exported in your feed and VRBO imports your feed, that's fine — it correctly blocks those dates on VRBO. But if Airbnb also imports your feed, it will see its own bookings reflected back, which is harmless but can cause confusion in the Airbnb dashboard showing duplicate blocks. The cleaner approach is to **exclude** events that originated from iCal import.

### 3.3 NestJS Controller

```typescript
// src/calendar/calendar.controller.ts

import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { CalendarSyncService } from './calendar-sync.service';

@Controller('api/calendar')
export class CalendarController {
  constructor(private readonly calendarSyncService: CalendarSyncService) {}

  @Get('export.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async exportCalendar(@Res() res: Response): Promise<void> {
    const icsContent = await this.calendarSyncService.generateExportFeed();
    res.set('Content-Disposition', 'inline; filename="owlsnest-calendar.ics"');
    res.send(icsContent);
  }
}
```

### 3.4 Feed Generation Service

```typescript
// src/calendar/calendar-export.service.ts

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { BlockedDate } from './blocked-date.entity';

@Injectable()
export class CalendarExportService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepo: Repository<Booking>,
    @InjectRepository(BlockedDate)
    private blockedDateRepo: Repository<BlockedDate>,
  ) {}

  async generateExportFeed(): Promise<string> {
    // Fetch all exportable date blocks
    const bookings = await this.bookingRepo.find({
      where: {
        status: In(['approved', 'confirmed', 'completed']),
        source: 'direct', // Don't re-export OTA bookings
      },
    });

    const manualBlocks = await this.blockedDateRepo.find({
      where: { reason: In(['manual_block', 'maintenance']) },
    });

    // Build VCALENDAR
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//The Owls Nest//Booking Platform 1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:The Owl\'s Nest Availability',
    ];

    // Add booking events
    for (const booking of bookings) {
      lines.push(...this.buildVEvent({
        uid: `booking-${booking.id}@owlsnest.com`,
        dtstart: booking.check_in,
        dtend: booking.check_out,
        summary: 'Reserved',
        description: 'Direct booking - The Owl\'s Nest',
        dtstamp: booking.updated_at ?? booking.created_at,
      }));
    }

    // Add manual/maintenance blocks
    for (const block of manualBlocks) {
      lines.push(...this.buildVEvent({
        uid: `block-${block.id}@owlsnest.com`,
        dtstart: block.start_date,
        dtend: block.end_date,
        summary: 'Not available',
        description: block.reason === 'maintenance'
          ? 'Maintenance block'
          : 'Manually blocked',
        dtstamp: block.created_at,
      }));
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  private buildVEvent(params: {
    uid: string;
    dtstart: Date;
    dtend: Date;
    summary: string;
    description: string;
    dtstamp: Date;
  }): string[] {
    return [
      'BEGIN:VEVENT',
      `UID:${params.uid}`,
      `DTSTART;VALUE=DATE:${this.formatDate(params.dtstart)}`,
      `DTEND;VALUE=DATE:${this.formatDate(params.dtend)}`,
      `DTSTAMP:${this.formatDateTime(params.dtstamp)}`,
      `SUMMARY:${this.escapeIcalText(params.summary)}`,
      `DESCRIPTION:${this.escapeIcalText(params.description)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    ];
  }

  /** Format a Date as YYYYMMDD for VALUE=DATE properties */
  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /** Format a Date as YYYYMMDDTHHMMSSZ for DTSTAMP */
  private formatDateTime(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /** Escape special characters per RFC 5545 */
  private escapeIcalText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }
}
```

### 3.5 Feed Requirements Checklist

- [ ] `Content-Type: text/calendar; charset=utf-8`
- [ ] `Cache-Control: no-cache` — OTAs should always get the latest version
- [ ] UID is stable per booking/block (never regenerated on feed refresh)
- [ ] `DTSTART` / `DTEND` use `VALUE=DATE` format (no time component)
- [ ] `TRANSP:OPAQUE` is set on all events (marks time as busy)
- [ ] Line endings are `\r\n` (CRLF) per RFC 5545
- [ ] Lines do not exceed 75 octets (fold long lines with leading space if needed)
- [ ] Special characters in text fields are escaped (`\,` `\;` `\\` `\n`)
- [ ] Feed responds in under 500ms (PRD non-functional requirement)

### 3.6 Registering the Export Feed on OTAs

**Airbnb:**
1. Go to Host → Calendar → select listing
2. Click Availability → Sync calendars → Import calendar
3. Paste `https://owlsnest.com/calendar.ics`
4. Name it "Owl's Nest Direct" → Import

**VRBO:**
1. Log into Owner Dashboard → select listing
2. Calendar → Settings → Availability tab → Calendar sync → Connect calendars
3. Import a calendar → paste `https://owlsnest.com/calendar.ics`
4. Name it (max 30 characters) → Import

---

## 4. Import Implementation (OTAs → Platform)

### 4.1 OTA Feed URLs

Each OTA provides a unique export URL for your listing. You obtain these from each platform's dashboard:

**Airbnb:**
Host → Calendar → Availability → Sync calendars → Export calendar → Copy link

Format: `https://www.airbnb.com/calendar/ical/LISTING_ID.ics?s=HASH`

**VRBO:**
Owner Dashboard → Calendar → Import & Export → Export Calendar → Copy link

Format: `https://www.vrbo.com/icalendar/TOKEN.ics`

These URLs are stored in the `calendar_sync` table (PRD data model) and configured via the admin dashboard Settings → iCal Feed Management.

### 4.2 Data Model

The PRD already defines the relevant entities. Here's the refined version with import-specific fields:

```sql
-- Tracks configured OTA feed URLs and sync state
CREATE TABLE calendar_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,              -- 'airbnb', 'vrbo', 'booking_com'
  ical_import_url TEXT NOT NULL,              -- OTA's export URL
  last_synced_at TIMESTAMPTZ,
  last_sync_status VARCHAR(20) DEFAULT 'pending', -- 'success', 'failed', 'pending'
  last_sync_error TEXT,
  last_sync_event_count INT DEFAULT 0,
  sync_interval_minutes INT NOT NULL DEFAULT 15,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores date blocks imported from OTA feeds
-- Each row represents one VEVENT from an imported feed
CREATE TABLE blocked_date (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES property(id),
  start_date DATE NOT NULL,                    -- DTSTART from VEVENT
  end_date DATE NOT NULL,                      -- DTEND from VEVENT (exclusive)
  reason VARCHAR(50) NOT NULL,                 -- 'ota_booking', 'manual_block', 'maintenance'
  source_platform VARCHAR(50),                 -- 'airbnb', 'vrbo', null for manual
  source_event_uid VARCHAR(500),               -- UID from the VEVENT (for dedup/update tracking)
  source_summary VARCHAR(500),                 -- SUMMARY field (e.g., guest name from Airbnb)
  calendar_sync_id UUID REFERENCES calendar_sync(id), -- which feed this came from
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_event_uid, calendar_sync_id)   -- prevent duplicate imports
);

CREATE INDEX idx_blocked_date_range ON blocked_date (start_date, end_date);
CREATE INDEX idx_blocked_date_source ON blocked_date (source_event_uid, calendar_sync_id);
```

### 4.3 Import Service

The import service fetches each configured OTA feed, parses the iCal content, and upserts blocked dates.

**Dependencies:**
```bash
npm install node-ical    # iCal parser with TypeScript support
```

```typescript
// src/calendar/calendar-import.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ical from 'node-ical';
import { CalendarSync } from './calendar-sync.entity';
import { BlockedDate } from './blocked-date.entity';

interface ParsedEvent {
  uid: string;
  startDate: Date;
  endDate: Date;
  summary: string;
  description?: string;
}

@Injectable()
export class CalendarImportService {
  private readonly logger = new Logger(CalendarImportService.name);

  constructor(
    @InjectRepository(CalendarSync)
    private syncRepo: Repository<CalendarSync>,
    @InjectRepository(BlockedDate)
    private blockedDateRepo: Repository<BlockedDate>,
  ) {}

  /**
   * Poll all active feeds. Called by the scheduled job.
   */
  async pollAllFeeds(): Promise<void> {
    const feeds = await this.syncRepo.find({ where: { active: true } });

    for (const feed of feeds) {
      try {
        await this.importFeed(feed);
      } catch (error) {
        this.logger.error(
          `Failed to sync ${feed.platform} feed ${feed.id}: ${error.message}`,
        );
        await this.syncRepo.update(feed.id, {
          last_sync_status: 'failed',
          last_sync_error: error.message,
          last_synced_at: new Date(),
        });
      }
    }
  }

  /**
   * Import a single OTA feed.
   */
  async importFeed(feed: CalendarSync): Promise<void> {
    this.logger.log(`Importing ${feed.platform} feed...`);

    // 1. Fetch and parse the iCal feed
    const rawEvents = await this.fetchAndParse(feed.ical_import_url);

    // 2. Extract VEVENT data
    const parsedEvents = this.extractEvents(rawEvents);

    // 3. Determine the current set of UIDs from the feed
    const feedUids = new Set(parsedEvents.map((e) => e.uid));

    // 4. Get existing blocked dates for this feed
    const existingBlocks = await this.blockedDateRepo.find({
      where: { calendar_sync_id: feed.id },
    });
    const existingByUid = new Map(
      existingBlocks.map((b) => [b.source_event_uid, b]),
    );

    // 5. Upsert events from the feed
    for (const event of parsedEvents) {
      const existing = existingByUid.get(event.uid);

      if (existing) {
        // Update if dates changed (modification)
        if (
          existing.start_date.getTime() !== event.startDate.getTime() ||
          existing.end_date.getTime() !== event.endDate.getTime()
        ) {
          await this.blockedDateRepo.update(existing.id, {
            start_date: event.startDate,
            end_date: event.endDate,
            source_summary: event.summary,
            updated_at: new Date(),
          });
          this.logger.log(
            `Updated ${feed.platform} block: ${event.uid} (dates changed)`,
          );
        }
      } else {
        // Insert new block
        await this.blockedDateRepo.save({
          property_id: feed.property_id,
          start_date: event.startDate,
          end_date: event.endDate,
          reason: 'ota_booking',
          source_platform: feed.platform,
          source_event_uid: event.uid,
          source_summary: event.summary,
          calendar_sync_id: feed.id,
        });
        this.logger.log(
          `New ${feed.platform} block: ${event.uid} (${event.startDate.toISOString()} - ${event.endDate.toISOString()})`,
        );
      }
    }

    // 6. Handle cancellations — UIDs that were previously imported
    //    but are no longer in the feed
    for (const existing of existingBlocks) {
      if (!feedUids.has(existing.source_event_uid)) {
        await this.blockedDateRepo.delete(existing.id);
        this.logger.log(
          `Removed ${feed.platform} block: ${existing.source_event_uid} (cancelled or expired)`,
        );
      }
    }

    // 7. Update sync status
    await this.syncRepo.update(feed.id, {
      last_synced_at: new Date(),
      last_sync_status: 'success',
      last_sync_error: null,
      last_sync_event_count: parsedEvents.length,
    });

    this.logger.log(
      `${feed.platform} sync complete: ${parsedEvents.length} events`,
    );
  }

  /**
   * Fetch iCal from URL and parse with node-ical.
   */
  private async fetchAndParse(
    url: string,
  ): Promise<Record<string, ical.CalendarComponent>> {
    return new Promise((resolve, reject) => {
      ical.fromURL(url, {}, (err, data) => {
        if (err) reject(new Error(`iCal fetch failed: ${err.message}`));
        else resolve(data);
      });
    });
  }

  /**
   * Extract VEVENT components into a normalized format.
   * Handles both Airbnb (rich) and VRBO (minimal) formats.
   */
  private extractEvents(
    rawEvents: Record<string, ical.CalendarComponent>,
  ): ParsedEvent[] {
    const events: ParsedEvent[] = [];

    for (const [key, component] of Object.entries(rawEvents)) {
      if (component.type !== 'VEVENT') continue;

      const vevent = component as ical.VEvent;

      // Skip events without valid date ranges
      if (!vevent.start || !vevent.end) {
        this.logger.warn(`Skipping VEVENT with missing dates: ${key}`);
        continue;
      }

      // Normalize dates to midnight UTC (DATE values have no time)
      const startDate = this.normalizeDate(vevent.start);
      const endDate = this.normalizeDate(vevent.end);

      // Skip events in the past (more than 1 day ago)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (endDate < yesterday) continue;

      // Skip zero-length or negative-length events
      if (endDate <= startDate) {
        this.logger.warn(`Skipping zero/negative-length VEVENT: ${key}`);
        continue;
      }

      events.push({
        uid: vevent.uid || key,
        startDate,
        endDate,
        summary: vevent.summary || 'Reserved',
        description: vevent.description,
      });
    }

    return events;
  }

  /**
   * Normalize a date to YYYY-MM-DD midnight UTC.
   * node-ical may return Date objects or date strings depending
   * on whether VALUE=DATE or VALUE=DATE-TIME is used.
   */
  private normalizeDate(date: ical.DateWithTimeZone | Date): Date {
    const d = new Date(date);
    // Strip time component — we only care about the date
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
}
```

### 4.4 Scheduled Polling Job

Use NestJS's `@nestjs/schedule` module with a cron-based interval.

```typescript
// src/calendar/calendar-sync.scheduler.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CalendarImportService } from './calendar-import.service';

@Injectable()
export class CalendarSyncScheduler {
  private readonly logger = new Logger(CalendarSyncScheduler.name);
  private isSyncing = false;

  constructor(private readonly importService: CalendarImportService) {}

  /**
   * Poll all active OTA feeds every 15 minutes.
   * Includes a mutex to prevent overlapping runs.
   */
  @Cron('0 */15 * * * *') // Every 15 minutes at :00 seconds
  async handlePoll(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Previous sync still running — skipping this cycle');
      return;
    }

    this.isSyncing = true;
    try {
      this.logger.log('Starting scheduled iCal sync...');
      await this.importService.pollAllFeeds();
      this.logger.log('Scheduled iCal sync complete');
    } catch (error) {
      this.logger.error(`Scheduled sync failed: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }
  }
}
```

### 4.5 Manual "Sync Now" Endpoint

The admin dashboard needs a button to force-sync before approving a booking request.

```typescript
// Add to CalendarController

@Post('sync-now')
async syncNow(): Promise<{ success: boolean; message: string }> {
  await this.calendarImportService.pollAllFeeds();
  return { success: true, message: 'All feeds synced' };
}

@Post('sync-now/:feedId')
async syncOneFeed(
  @Param('feedId') feedId: string,
): Promise<{ success: boolean; message: string }> {
  const feed = await this.calendarSyncService.findFeedById(feedId);
  if (!feed) throw new NotFoundException('Feed not found');
  await this.calendarImportService.importFeed(feed);
  return { success: true, message: `${feed.platform} feed synced` };
}
```

### 4.6 Parsing Platform-Specific Data

While the import service treats all feeds uniformly for date blocking, you can optionally extract platform-specific metadata for display in the admin dashboard.

```typescript
// src/calendar/parsers/airbnb-parser.ts

interface AirbnbBookingMeta {
  guestName: string | null;
  confirmationCode: string | null;
  nights: number | null;
  guestCount: number | null;
  phone: string | null;
  email: string | null;
}

/**
 * Parse Airbnb-specific metadata from SUMMARY and DESCRIPTION.
 * This data is supplementary — do not depend on it for core logic.
 * Airbnb has reduced iCal data before and may do so again.
 */
export function parseAirbnbMeta(
  summary?: string,
  description?: string,
): AirbnbBookingMeta {
  const meta: AirbnbBookingMeta = {
    guestName: null,
    confirmationCode: null,
    nights: null,
    guestCount: null,
    phone: null,
    email: null,
  };

  // SUMMARY format: "Jane Smith (HABCD1234)"
  if (summary) {
    const summaryMatch = summary.match(/^(.+?)\s*\(([A-Z0-9]+)\)$/);
    if (summaryMatch) {
      meta.guestName = summaryMatch[1].trim();
      meta.confirmationCode = summaryMatch[2];
    }
  }

  // DESCRIPTION format: key-value pairs separated by \n
  if (description) {
    const lines = description.split(/\\n|\n/);
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      switch (key?.trim().toUpperCase()) {
        case 'NIGHTS':
          meta.nights = parseInt(value, 10) || null;
          break;
        case 'GUESTS':
          meta.guestCount = parseInt(value, 10) || null;
          break;
        case 'PHONE':
          meta.phone = value || null;
          break;
        case 'EMAIL':
          meta.email = value || null;
          break;
      }
    }
  }

  return meta;
}
```

**Usage note:** This parsed metadata is for admin convenience only (showing guest names on the calendar). The core blocking logic should never depend on DESCRIPTION content — only `DTSTART`, `DTEND`, and `UID`.

---

## 5. Conflict Detection

### 5.1 Availability Check Query

When a guest submits a booking request on the direct booking site, or when the owner is reviewing a request for approval, the system must check for conflicts against all sources.

```typescript
// src/booking/availability.service.ts

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Booking } from './booking.entity';
import { BlockedDate } from '../calendar/blocked-date.entity';

interface ConflictResult {
  available: boolean;
  conflicts: Array<{
    source: string;       // 'direct', 'airbnb', 'vrbo', 'manual_block', etc.
    startDate: Date;
    endDate: Date;
    description: string;  // "Airbnb booking Jul 15–18", "Manual block", etc.
  }>;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepo: Repository<Booking>,
    @InjectRepository(BlockedDate)
    private blockedDateRepo: Repository<BlockedDate>,
  ) {}

  /**
   * Check if a date range is available.
   * A range conflicts if any existing block overlaps with it.
   * Two ranges [A_start, A_end) and [B_start, B_end) overlap
   * when A_start < B_end AND B_start < A_end.
   */
  async checkAvailability(
    checkIn: Date,
    checkOut: Date,
  ): Promise<ConflictResult> {
    const conflicts: ConflictResult['conflicts'] = [];

    // Check direct bookings
    const directConflicts = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.status IN (:...statuses)', {
        statuses: ['approved', 'confirmed', 'pending_approval'],
      })
      .andWhere('b.check_in < :checkOut', { checkOut })
      .andWhere('b.check_out > :checkIn', { checkIn })
      .getMany();

    for (const booking of directConflicts) {
      conflicts.push({
        source: booking.source,
        startDate: booking.check_in,
        endDate: booking.check_out,
        description: `${booking.source} booking ${this.formatRange(booking.check_in, booking.check_out)}`,
      });
    }

    // Check imported OTA blocks and manual blocks
    const blockConflicts = await this.blockedDateRepo
      .createQueryBuilder('bd')
      .where('bd.start_date < :checkOut', { checkOut })
      .andWhere('bd.end_date > :checkIn', { checkIn })
      .getMany();

    for (const block of blockConflicts) {
      conflicts.push({
        source: block.source_platform || block.reason,
        startDate: block.start_date,
        endDate: block.end_date,
        description:
          block.reason === 'ota_booking'
            ? `${block.source_platform} booking ${this.formatRange(block.start_date, block.end_date)}`
            : `${block.reason} ${this.formatRange(block.start_date, block.end_date)}`,
      });
    }

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  private formatRange(start: Date, end: Date): string {
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(start)}–${fmt(end)}`;
  }
}
```

### 5.2 Admin Approval Flow Integration

When the owner clicks to approve a booking request in the admin dashboard:

1. Admin clicks "Approve" on a booking request
2. Frontend calls `POST /api/calendar/sync-now` (force-sync all feeds)
3. Frontend calls `GET /api/bookings/:id/check-conflicts` (runs availability check for the request's dates)
4. If conflicts exist → display a warning with conflict details, require confirmation to override
5. If no conflicts → proceed with approval, send Stripe payment link

This two-step check (fresh sync + availability check) is the primary double-booking safeguard. The request-to-book flow is specifically designed for this — instant book would bypass this safety net.

---

## 6. Error Handling & Resilience

### 6.1 Fetch Failures

OTA feeds may be temporarily unavailable due to platform outages, rate limiting, or network issues.

```typescript
// Retry logic with exponential backoff (in CalendarImportService)

private async fetchWithRetry(
  url: string,
  maxRetries = 3,
): Promise<Record<string, ical.CalendarComponent>> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.fetchAndParse(url);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        this.logger.warn(
          `Fetch attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

### 6.2 Parse Failures

If a feed returns valid HTTP but invalid iCal content:

- Log the raw response body (first 500 chars) for debugging
- Mark the feed as `last_sync_status: 'failed'` with a descriptive error
- Do **not** delete existing blocked dates — stale blocks are safer than missing blocks
- Surface the failure in the admin dashboard with a warning banner

### 6.3 Feed URL Expiration

OTA feed URLs can expire or change (especially VRBO). If a feed consistently fails:

- After 3 consecutive failures, flag the feed in the admin dashboard
- After 24 hours of failures, send an admin notification (SMS or browser notification, per PRD Open Question #5)
- Never automatically disable a feed — let the owner investigate

### 6.4 Edge Cases

| Scenario | Handling |
|----------|---------|
| OTA booking modified (dates changed) | UID stays the same, DTSTART/DTEND change. Import service detects date mismatch and updates the `blocked_date` row. |
| OTA booking cancelled | UID disappears from the feed. Import service removes the corresponding `blocked_date` row (step 6 in import logic). |
| Same-day booking + checkout | Overlap check uses half-open interval `[check_in, check_out)`. If one guest checks out July 18 and another checks in July 18, there is no conflict — July 18 is available for check-in. |
| Feed returns 0 events | This could be legitimate (no bookings) or a platform error. Log a warning if the previous sync had events — a sudden drop to zero may indicate a broken URL. Do NOT delete existing blocks in this case. |
| Airbnb 365-day limit | Bookings beyond 365 days from now won't appear in Airbnb's feed. For the single-property Owl's Nest this is unlikely to matter, but log a note if a direct booking is made more than 365 days out — it won't be blocked on Airbnb via iCal. |

### 6.5 Zero-Event Safety Check

To prevent a broken feed from clearing all your blocks:

```typescript
// In importFeed(), before the cancellation removal step:

// Safety: if the feed returns 0 events but we had blocks before,
// don't delete them — the feed is likely broken
if (parsedEvents.length === 0 && existingBlocks.length > 0) {
  this.logger.warn(
    `${feed.platform} feed returned 0 events but ${existingBlocks.length} ` +
    `blocks exist. Skipping removal — feed may be broken.`,
  );
  // Still update sync timestamp but flag the status
  await this.syncRepo.update(feed.id, {
    last_synced_at: new Date(),
    last_sync_status: 'warning',
    last_sync_error: 'Feed returned 0 events — existing blocks preserved',
    last_sync_event_count: 0,
  });
  return;
}
```

---

## 7. Admin Dashboard Views

### 7.1 Calendar View — OTA Booking Display

OTA bookings imported via iCal should appear on the admin calendar with clear visual differentiation:

| Booking Source | Calendar Color | Label Format |
|---------------|---------------|-------------|
| Direct booking | Brand green (`#2F4F3A`) | Guest name + dates |
| Airbnb | Airbnb coral/red (`#FF5A5F`) | "Airbnb" + guest name if available, or "Airbnb Booking" |
| VRBO | VRBO blue (`#0057B8`) | "VRBO Booking" (VRBO doesn't provide guest names) |
| Manual block | Gray (`#999999`) | "Blocked" or custom reason |
| Maintenance | Orange (`#E67E22`) | "Maintenance" |

### 7.2 iCal Feed Management (Settings)

The admin Settings page needs an "iCal Sync" section:

**For each configured feed, display:**
- Platform name and icon
- Feed URL (masked, with copy button)
- Last synced timestamp
- Last sync status (success / failed / warning)
- Event count from last sync
- Sync interval (editable)
- Active toggle
- "Sync Now" button
- "Remove" button (with confirmation)

**Add Feed flow:**
1. Select platform from dropdown (Airbnb, VRBO, Booking.com, Other)
2. Paste iCal export URL
3. System validates the URL format and attempts a test fetch
4. On success → save and run first import
5. On failure → show error, allow retry

**Export Feed section:**
- Display the platform's export URL: `https://owlsnest.com/calendar.ics`
- Copy button
- Instructions for pasting into each OTA

### 7.3 Sync Health Indicator

Add a small sync health indicator to the main dashboard header or calendar view:

- Green dot: all feeds synced successfully within the last sync interval
- Yellow dot: one or more feeds returned warnings or haven't synced in 2× their interval
- Red dot: one or more feeds are failing

---

## 8. Testing

### 8.1 Test iCal Feeds

Create local test `.ics` files for each platform format to verify parsing without depending on live OTA feeds.

```typescript
// test/fixtures/airbnb-sample.ics
export const AIRBNB_SAMPLE = `BEGIN:VCALENDAR
PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.2.5//EN
CALSCALE:GREGORIAN
VERSION:2.0
BEGIN:VEVENT
DTEND;VALUE=DATE:20260718
DTSTART;VALUE=DATE:20260715
UID:test-uid-001@airbnb.com
DESCRIPTION:CHECKIN: 15/07/2026\\nCHECKOUT: 18/07/2026\\nNIGHTS: 3\\nPHONE: +1 555-000-0000\\nEMAIL: test@example.com\\nPROPERTY: Test Property\\nGUESTS: 2
SUMMARY:Test Guest (HTEST001)
LOCATION:Test Property
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20260725
DTSTART;VALUE=DATE:20260720
UID:test-uid-002@airbnb.com
SUMMARY:Another Guest (HTEST002)
LOCATION:Test Property
END:VEVENT
END:VCALENDAR`;

// test/fixtures/vrbo-sample.ics
export const VRBO_SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//vrbo.com//NONSGML Vrbo Calendar//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260801
DTEND;VALUE=DATE:20260805
UID:vrbo-test-001@vrbo.com
SUMMARY:Reserved
DTSTAMP:20260725T120000Z
END:VEVENT
END:VCALENDAR`;
```

### 8.2 Test Matrix

| Test Case | What to Verify |
|-----------|---------------|
| Import Airbnb feed with multiple events | All events parsed, correct dates stored, guest name extracted from SUMMARY |
| Import VRBO feed with minimal data | Events parsed despite missing DESCRIPTION, summary defaults to "Reserved" |
| Booking modification (dates change, same UID) | Existing `blocked_date` row updated, not duplicated |
| Booking cancellation (UID removed from feed) | Corresponding `blocked_date` row deleted |
| Zero-event feed with existing blocks | Blocks preserved, warning logged |
| Export feed contains only direct bookings | No OTA bookings re-exported, manual blocks included |
| Export feed date format | `DTSTART;VALUE=DATE:YYYYMMDD` format, no time component |
| Availability check — no conflict | Returns `available: true`, empty conflicts array |
| Availability check — overlapping OTA block | Returns `available: false` with conflict details |
| Same-day turnaround | Check-out day A == check-in day B → no conflict |
| Feed URL returns HTTP error | Retry with backoff, mark feed as failed, preserve existing blocks |
| Feed URL returns invalid content | Parse error caught, feed marked as failed, existing blocks preserved |
| Concurrent sync prevention | Second poll skipped if first is still running |

### 8.3 Integration Testing Approach

For end-to-end testing without live OTA feeds:

1. Serve test `.ics` files from a local HTTP server during tests
2. Configure `calendar_sync` rows pointing to local URLs
3. Run the import job and assert database state
4. Modify the served `.ics` to simulate booking changes
5. Re-run import and verify upserts/deletes

---

## 9. Phasing Alignment

| Phase | iCal Work |
|-------|-----------|
| **Phase 1 (Foundation)** | Export feed endpoint, `blocked_date` table for manual blocks, export feed generation from direct bookings + manual blocks |
| **Phase 2 (Operations)** | Import service with `node-ical`, `calendar_sync` table, scheduled polling job, availability conflict detection, "Sync Now" button, admin feed management UI |
| **Phase 3 (Content & Growth)** | — (no iCal changes) |
| **Phase 4 (Polish & Scale)** | Booking.com and Google Vacation Rentals iCal sync, sync health dashboard, admin notifications for feed failures |

---

## 10. PRD Open Question #3 — Resolution

> **iCal sync reliability — What is the actual polling frequency and delay for Airbnb/VRBO iCal feeds? Do they rate-limit requests?**

**Answer based on research:**

- **Airbnb** polls imported calendars approximately every 2–3 hours. Manual refresh is available via the host dashboard. There is no documented rate limit for serving your export feed to Airbnb, as Airbnb initiates the fetch.
- **VRBO** polls imported calendars approximately every 30 minutes. Manual refresh is available via the owner dashboard.
- **Your platform polling OTA feeds:** A 15-minute interval is standard for PMS tools and well within acceptable bounds. Going below 5 minutes is not recommended — it provides diminishing returns and may trigger rate limiting on the OTA side. Neither Airbnb nor VRBO publish explicit rate limits for iCal feed endpoints, but community reports suggest feeds are throttled if polled more than once per minute.
- **Worst-case sync delay:** If a guest books on Airbnb at the exact moment after you polled, the booking won't appear in your system for up to 15 minutes (your poll interval). Airbnb won't block the dates on its own listing for your direct booking feed for up to 2–3 hours. VRBO is faster at ~30 minutes.
- **Mitigation:** The request-to-book flow with manual owner approval + "Sync Now" button before approval is the effective safeguard. iCal sync alone is insufficient for preventing double bookings during high-demand periods.

**Recommendation:** Keep the 15-minute default poll interval. For the export feed, ensure it responds instantly with current data (no caching). The request-to-book approval flow is the real protection — iCal sync just minimizes the window.

---

## 11. Module Structure

```
src/calendar/
├── calendar.module.ts              # NestJS module definition
├── calendar.controller.ts          # Export feed + sync endpoints
├── calendar-export.service.ts      # Generate export .ics feed
├── calendar-import.service.ts      # Fetch + parse OTA feeds
├── calendar-sync.scheduler.ts      # Cron-based polling job
├── availability.service.ts         # Conflict detection queries
├── entities/
│   ├── calendar-sync.entity.ts     # OTA feed configuration
│   └── blocked-date.entity.ts      # Imported/manual date blocks
├── parsers/
│   ├── airbnb-parser.ts            # Airbnb-specific metadata extraction
│   └── vrbo-parser.ts              # VRBO-specific metadata extraction
└── dto/
    ├── add-feed.dto.ts             # Validation for adding a new feed
    └── sync-result.dto.ts          # Response format for sync status
```

---

*This document supplements PRD Section 5 (Calendar Sync) with implementation-level detail. It should be reviewed alongside the PRD and TLT Tax Plan when building Phase 1 and Phase 2 of the platform.*