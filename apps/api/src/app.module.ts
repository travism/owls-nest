import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { TaxModule } from './tax/tax.module';
import { PricingModule } from './pricing/pricing.module';
import { PropertyModule } from './property/property.module';
import { BlockedDateModule } from './blocked-date/blocked-date.module';
import { CalendarModule } from './calendar/calendar.module';
import { InquiryModule } from './inquiry/inquiry.module';
import { BookingModule } from './booking/booking.module';
import { StripeModule } from './integrations/stripe/stripe.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AppThrottlerModule } from './throttler/throttler.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        customProps: () => ({ service: 'api' }),
      },
    }),
    AppThrottlerModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    TaxModule,
    PricingModule,
    PropertyModule,
    BlockedDateModule,
    CalendarModule,
    StripeModule,
    BookingModule,
    InquiryModule,
    WebhooksModule,
  ],
  providers: [
    // Apply ThrottlerGuard globally — uses the 'default' bucket (100/min/IP)
    // unless a route opts into a stricter named bucket via @Throttle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
