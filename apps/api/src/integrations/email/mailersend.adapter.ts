// MailerSend adapter for production. Wraps the official SDK and rethrows
// any failure as ServiceUnavailableException — matches the shape the rest of
// the app expects (see RealStripeAdapter).
//
// If MAILERSEND_API_KEY is missing, the adapter still constructs but every
// send throws; this keeps the API bootable without prod creds for dev/CI.

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import type {
  EmailAdapter,
  EmailMessage,
  EmailSendResult,
} from './email.types';

@Injectable()
export class MailerSendAdapter implements EmailAdapter {
  private readonly log = new Logger(MailerSendAdapter.name);
  private readonly client: MailerSend | null;

  constructor() {
    const apiKey = process.env.MAILERSEND_API_KEY;
    if (apiKey) {
      this.client = new MailerSend({ apiKey });
    } else {
      this.client = null;
      this.log.warn('MAILERSEND_API_KEY not set — MailerSend calls will throw.');
    }
  }

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'INTERNAL_ERROR',
        message: 'MailerSend is not configured.',
      });
    }
    const fromEmail = process.env.EMAIL_FROM ?? process.env.MAILERSEND_FROM_EMAIL;
    if (!fromEmail) {
      throw new ServiceUnavailableException({
        code: 'INTERNAL_ERROR',
        message: 'EMAIL_FROM (or MAILERSEND_FROM_EMAIL) is not configured.',
      });
    }
    const sender = new Sender(fromEmail, "The Owl's Nest");
    const recipients = [new Recipient(msg.to)];
    const params = new EmailParams()
      .setFrom(sender)
      .setTo(recipients)
      .setSubject(msg.subject)
      .setHtml(msg.html)
      .setText(msg.text);
    if (msg.tags && msg.tags.length > 0) params.setTags(msg.tags);
    try {
      const res = await this.client.email.send(params);
      // MailerSend returns the message id in the x-message-id header.
      const id =
        (res as { headers?: Record<string, string> }).headers?.['x-message-id'] ??
        `ms_${Date.now()}`;
      return { id, provider: 'mailersend' };
    } catch (err) {
      this.log.error(
        { err: (err as Error).message },
        'MailerSend send failed',
      );
      throw new ServiceUnavailableException({
        code: 'INTERNAL_ERROR',
        message: 'Email provider unavailable.',
      });
    }
  }
}
