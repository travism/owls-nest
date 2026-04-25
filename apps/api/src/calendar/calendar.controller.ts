import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CalendarExportService } from './calendar-export.service';

@Controller('api/v1/calendar')
export class CalendarController {
  constructor(private readonly exportService: CalendarExportService) {}

  /**
   * Public iCal feed. OTAs poll this without credentials.
   * Cloudflare path rewrite from /calendar.ics to this endpoint
   * happens at the edge in production.
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
