// Rate-limiting e2e (CO-11).
//
// This test bypasses the normal createTestApp() helper because the test
// throttler module bumps every limit 100x. We need a fresh app with
// the actual @Throttle limits applied so we can verify a 429.
//
// Strategy: spin up a tiny standalone Nest app with just one controller
// (to keep the test fast), wire the real ThrottlerModule with prod-shape
// limits, hit the controller N+1 times, assert the (N+1)th comes back as
// 429 RATE_LIMITED in the standard envelope.

import 'reflect-metadata';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ThrottlerGuard,
  ThrottlerModule,
  Throttle,
  seconds,
} from '@nestjs/throttler';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';

@Controller('thr')
class ThrottleTestController {
  @Get('default')
  defaultBucket() {
    return { ok: true };
  }

  @Get('strict')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  strictBucket() {
    return { ok: true };
  }
}

// Mirrors the @Throttle shape we apply to the real admin booking endpoints
// (apps/api/src/booking/booking.controller.ts). The TEST_MULTIPLIER applied
// in throttler.module.ts only affects the global default bucket — per-route
// @Throttle() overrides like this one are evaluated as written, so we can
// test the realistic 5/60s limit here.
@Controller('api/v1/admin/bookings')
class AdminBookingThrottleStub {
  @Post(':id/approve')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  approve() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: seconds(60), limit: 5 },
    ]),
  ],
  controllers: [ThrottleTestController, AdminBookingThrottleStub],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class TestThrottlerAppModule {}

describe('Rate limiting (e2e)', () => {
  let app: import('@nestjs/common').INestApplication;
  let server: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestThrottlerAppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests up to the per-route limit then returns 429 RATE_LIMITED', async () => {
    // /thr/strict has limit 3
    for (let i = 1; i <= 3; i++) {
      const res = await request(server).get('/thr/strict');
      expect(res.status).toBe(200);
    }
    const overflow = await request(server).get('/thr/strict');
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe('RATE_LIMITED');
    expect(typeof overflow.body.error.message).toBe('string');
  });

  it('uses the global default limit on routes without @Throttle override', async () => {
    // /thr/default has the global limit 5. The strict test above used
    // a different route and bucket key so this counter starts fresh.
    for (let i = 1; i <= 5; i++) {
      const res = await request(server).get('/thr/default');
      expect(res.status).toBe(200);
    }
    const overflow = await request(server).get('/thr/default');
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe('RATE_LIMITED');
  });

  it('throttles POST /admin/bookings/:id/approve at 5/60s — 6th call returns 429 RATE_LIMITED', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    for (let i = 1; i <= 5; i++) {
      const res = await request(server).post(`/api/v1/admin/bookings/${id}/approve`);
      // Nest defaults POST to 201; the stub returns plain JSON either way.
      expect(res.status).toBeLessThan(300);
    }
    const overflow = await request(server).post(
      `/api/v1/admin/bookings/${id}/approve`,
    );
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe('RATE_LIMITED');
  });

  it('429 response uses the standard envelope shape', async () => {
    const res = await request(server).get('/thr/strict');
    if (res.status === 429) {
      // Already at limit from prior test
      expect(res.body).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: expect.any(String),
        },
      });
    } else {
      // First call passes; trigger overflow
      for (let i = 0; i < 5; i++) await request(server).get('/thr/strict');
      const overflow = await request(server).get('/thr/strict');
      expect(overflow.status).toBe(429);
      expect(overflow.body).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: expect.any(String),
        },
      });
    }
  });
});
