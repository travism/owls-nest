// StripeModule — exposes a single STRIPE_ADAPTER provider that resolves
// to either the real or the fake adapter depending on env. Fake is only
// used when NODE_ENV=test or USE_FAKE_STRIPE=1, never in production.

import { Global, Module } from '@nestjs/common';
import { FakeStripeAdapter } from './fake-stripe.adapter';
import { RealStripeAdapter } from './real-stripe.adapter';
import { STRIPE_ADAPTER } from './stripe.types';

const useFake =
  process.env.NODE_ENV === 'test' || process.env.USE_FAKE_STRIPE === '1';

@Global()
@Module({
  providers: [
    FakeStripeAdapter,
    RealStripeAdapter,
    {
      provide: STRIPE_ADAPTER,
      useExisting: useFake ? FakeStripeAdapter : RealStripeAdapter,
    },
  ],
  exports: [STRIPE_ADAPTER, FakeStripeAdapter],
})
export class StripeModule {}
