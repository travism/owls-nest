import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalendarModule } from '../calendar/calendar.module';
import { PricingModule } from '../pricing/pricing.module';
import { BookingService } from './booking.service';
import { AdminBookingController } from './booking.controller';

@Module({
  imports: [AuthModule, CalendarModule, PricingModule],
  controllers: [AdminBookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
