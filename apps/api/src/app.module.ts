import { Module } from '@nestjs/common';
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
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    TaxModule,
    PricingModule,
    PropertyModule,
    BlockedDateModule,
    CalendarModule,
  ],
})
export class AppModule {}
