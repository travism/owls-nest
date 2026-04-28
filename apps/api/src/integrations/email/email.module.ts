// EmailModule — exposes a single EMAIL_ADAPTER provider.
//
// Resolution rules:
//   - NODE_ENV=test → FakeEmailAdapter (no network, recorded in-memory)
//   - else: EMAIL_PROVIDER env (mailhog|mailersend|fake)
//   - default: 'mailhog' for development, throws for production
//
// In production we hard-fail at boot if EMAIL_PROVIDER !== 'mailersend'
// (per D-021); D-001 stays the source of truth on the prod provider.

import { Global, Module, type Provider } from '@nestjs/common';
import { EMAIL_ADAPTER } from './email.types';
import { FakeEmailAdapter } from './fake-email.adapter';
import { MailHogAdapter } from './mailhog.adapter';
import { MailerSendAdapter } from './mailersend.adapter';

type Provider_ = 'mailhog' | 'mailersend' | 'fake';

function resolveProvider(): Provider_ {
  if (process.env.NODE_ENV === 'test') return 'fake';
  const explicit = process.env.EMAIL_PROVIDER as Provider_ | undefined;
  if (process.env.NODE_ENV === 'production') {
    if (explicit !== 'mailersend') {
      throw new Error(
        'Production environment requires EMAIL_PROVIDER=mailersend (D-021).',
      );
    }
    return 'mailersend';
  }
  if (explicit === 'mailhog' || explicit === 'mailersend' || explicit === 'fake') {
    return explicit;
  }
  // dev default
  return 'mailhog';
}

const adapterProvider: Provider = {
  provide: EMAIL_ADAPTER,
  useFactory: (
    fake: FakeEmailAdapter,
    mailhog: MailHogAdapter,
    mailersend: MailerSendAdapter,
  ) => {
    const which = resolveProvider();
    if (which === 'fake') return fake;
    if (which === 'mailhog') return mailhog;
    return mailersend;
  },
  inject: [FakeEmailAdapter, MailHogAdapter, MailerSendAdapter],
};

@Global()
@Module({
  providers: [
    FakeEmailAdapter,
    MailHogAdapter,
    MailerSendAdapter,
    adapterProvider,
  ],
  exports: [EMAIL_ADAPTER, FakeEmailAdapter],
})
export class EmailModule {}
