import { Module } from '@nestjs/common';
import { AvailabilityController, CalendarController } from './calendar.controller';
import { CalendarExportService } from './calendar-export.service';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [CalendarController, AvailabilityController],
  providers: [CalendarExportService, AvailabilityService],
  exports: [CalendarExportService, AvailabilityService],
})
export class CalendarModule {}
