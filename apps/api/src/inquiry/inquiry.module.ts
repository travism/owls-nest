import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InquiryService } from './inquiry.service';
import {
  AdminInquiryController,
  PublicInquiryController,
} from './inquiry.controller';

@Module({
  imports: [AuthModule],
  controllers: [PublicInquiryController, AdminInquiryController],
  providers: [InquiryService],
  exports: [InquiryService],
})
export class InquiryModule {}
