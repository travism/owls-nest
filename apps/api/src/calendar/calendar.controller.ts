import { Controller, Get, Header, Query, Res, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import {
  AvailabilityRequestSchema,
  type AvailabilityResponse,
} from '@owlsnest/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { CalendarExportService } from './calendar-export.service';
import { AvailabilityService } from './availability.service';

type AvailabilityQuery = z.infer<typeof AvailabilityRequestSchema>;

@Controller('api/v1/calendar')
export class CalendarController {
  constructor(private readonly exportService: CalendarExportService) {}

  /**
   * Public iCal feed. OTAs poll this without credentials.
   * Cloudflare path rewrite from /calendar.ics → /api/v1/calendar/export.ics
   * happens at the edge in production (CO-2).
   */
  @Get('export.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Content-Disposition', 'inline; filename="owlsnest-calendar.ics"')
  async exportIcs(@Res({ passthrough: true }) res: Response): Promise<string> {
    void res;
    return this.exportService.generateExportFeed();
  }
}

@Controller('api/v1/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  /**
   * Public availability feed for the booking calendar.
   * Returns unavailable date ranges within [from, to).
   */
  @Get()
  @UsePipes(new ZodValidationPipe(AvailabilityRequestSchema))
  async list(@Query() q: AvailabilityQuery): Promise<AvailabilityResponse> {
    const from = new Date(q.from);
    const to = new Date(q.to);
    const ranges = await this.availabilityService.listUnavailableInRange(from, to);
    return {
      from: q.from,
      to: q.to,
      unavailable: ranges.map((r) => ({
        startDate: toISODate(r.startDate),
        endDate: toISODate(r.endDate),
      })),
    };
  }
}

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
