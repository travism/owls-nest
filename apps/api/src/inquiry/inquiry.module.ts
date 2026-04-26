import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingModule } from '../booking/booking.module';
import { InquiryService } from './inquiry.service';
import {
  AdminInquiryController,
  PublicInquiryController,
} from './inquiry.controller';

@Module({
  imports: [AuthModule, BookingModule],
  controllers: [PublicInquiryController, AdminInquiryController],
  providers: [InquiryService],
  exports: [InquiryService],
})
export class InquiryModule {}
