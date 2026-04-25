import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarExportService } from './calendar-export.service';

@Module({
  controllers: [CalendarController],
  providers: [CalendarExportService],
  exports: [CalendarExportService],
})
export class CalendarModule {}
