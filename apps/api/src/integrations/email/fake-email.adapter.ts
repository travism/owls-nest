// In-memory email adapter for tests. Records every message in `sent` so
// e2e tests can assert which emails the outbox drain dispatched.

import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  EmailAdapter,
  EmailMessage,
  EmailSendResult,
} from './email.types';

@Injectable()
export class FakeEmailAdapter implements EmailAdapter {
  readonly sent: EmailMessage[] = [];

  // Single-shot test helper — set by tests to force the next send to throw.
  failNextWith: Error | null = null;

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    if (this.failNextWith) {
      const err = this.failNextWith;
      this.failNextWith = null;
      throw err;
    }
    this.sent.push(msg);
    return {
      id: `fake_${randomBytes(8).toString('hex')}`,
      provider: 'fake',
    };
  }

  /** Test helper — most recent message, or undefined if none sent. */
  last(): EmailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  /** Test helper — clear the in-memory buffer between tests. */
  reset(): void {
    this.sent.length = 0;
    this.failNextWith = null;
  }
}
