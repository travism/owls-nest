// M11: tests for the env loader's MailerSend boot guard.
//
// loadEnv() reads from process.env, so each test sets the relevant variables
// then restores. We avoid touching process.exit() — production-secret
// enforcement uses exit; the MailerSend guard throws a real Error so it can
// be asserted on directly.

import { loadEnv } from './env';

describe('loadEnv — MailerSend boot guard', () => {
  const ORIGINAL_ENV = { ...process.env };

  function reset() {
    process.env = { ...ORIGINAL_ENV };
    // Common defaults the schema requires:
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://owlsnest:owlsnest@localhost:5432/owlsnest_test';
  }

  beforeEach(() => {
    reset();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('passes when EMAIL_PROVIDER is not mailersend', () => {
    process.env.EMAIL_PROVIDER = 'fake';
    expect(() => loadEnv()).not.toThrow();
  });

  it('throws naming MAILERSEND_API_KEY when the API key is missing', () => {
    process.env.EMAIL_PROVIDER = 'mailersend';
    process.env.MAILERSEND_API_KEY = '';
    process.env.MAILERSEND_FROM_EMAIL = 'from@example.com';
    expect(() => loadEnv()).toThrow(/MAILERSEND_API_KEY/);
  });

  it('throws naming MAILERSEND_FROM_EMAIL when no from-address is set', () => {
    process.env.EMAIL_PROVIDER = 'mailersend';
    process.env.MAILERSEND_API_KEY = 'key';
    delete process.env.MAILERSEND_FROM_EMAIL;
    delete process.env.EMAIL_FROM;
    expect(() => loadEnv()).toThrow(/MAILERSEND_FROM_EMAIL/);
  });

  it('falls back to EMAIL_FROM when MAILERSEND_FROM_EMAIL is not set', () => {
    process.env.EMAIL_PROVIDER = 'mailersend';
    process.env.MAILERSEND_API_KEY = 'key';
    delete process.env.MAILERSEND_FROM_EMAIL;
    process.env.EMAIL_FROM = 'fallback@example.com';
    expect(() => loadEnv()).not.toThrow();
  });

  it('throws when the from-address is not a valid local@domain', () => {
    process.env.EMAIL_PROVIDER = 'mailersend';
    process.env.MAILERSEND_API_KEY = 'key';
    process.env.MAILERSEND_FROM_EMAIL = 'not-an-email';
    expect(() => loadEnv()).toThrow(/not a valid email/);
  });

  it('passes with a complete valid mailersend configuration', () => {
    process.env.EMAIL_PROVIDER = 'mailersend';
    process.env.MAILERSEND_API_KEY = 'mlsn.test';
    process.env.MAILERSEND_FROM_EMAIL = 'noreply@owlsnest.com';
    expect(() => loadEnv()).not.toThrow();
  });
});
