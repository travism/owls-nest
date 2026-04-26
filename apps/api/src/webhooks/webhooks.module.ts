import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { AuthModule } from '../auth/auth.module';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [BookingModule, AuthModule],
  controllers: [StripeWebhookController],
})
export class WebhooksModule {}
