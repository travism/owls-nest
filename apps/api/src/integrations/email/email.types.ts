// Email adapter surface area. Mirrors the StripeAdapter pattern so we can
// inject a fake in tests without dragging in either provider's SDK at the
// type level.
//
// EmailMessage carries everything the adapter needs to send one transactional
// message; templates render to this shape (see ./templates) and the outbox
// drain hands it to the adapter directly.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: string[];
  /**
   * Optional dedup key. MailerSend supports `X-Idempotency-Key`; MailHog
   * silently ignores it. We pass the outbox row's idempotencyKey through so
   * a retried drain doesn't double-send.
   */
  idempotencyKey?: string;
}

export interface EmailSendResult {
  id: string;
  provider: 'mailhog' | 'mailersend' | 'fake';
}

export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');

export interface EmailAdapter {
  sendEmail(msg: EmailMessage): Promise<EmailSendResult>;
}
