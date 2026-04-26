import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [BookingModule],
  controllers: [StripeWebhookController],
})
export class WebhooksModule {}
