// Global rate limiting per ARCHITECTURE.md §12.3 + CO-11.
//
// Single global bucket: 100 req/min/IP, applied to every route by the
// global ThrottlerGuard registered in app.module.ts. Hot endpoints
// (auth login, public POSTs) opt into a stricter override via
// @Throttle({ default: { limit: 5, ttl: 60_000 } }).
//
// In test env limits are bumped 100x so existing e2e suites — which
// fire many requests per file — don't accidentally trip them. The
// dedicated rate-limit.e2e-spec.ts wires its own throttler with
// realistic limits to actually exercise the 429 path.

import { Module } from '@nestjs/common';
import { ThrottlerModule, seconds } from '@nestjs/throttler';

const isTest = process.env.NODE_ENV === 'test';
const TEST_MULTIPLIER = isTest ? 1000 : 1;

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: seconds(60),
        limit: 100 * TEST_MULTIPLIER,
      },
    ]),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
