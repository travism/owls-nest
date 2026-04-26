// MailHog SMTP adapter for local dev. MailHog accepts any SMTP without auth
// and surfaces every captured email at http://localhost:8025.
//
// Connection is lazily established on first send so the API can boot without
// MailHog actually being up (e.g. in CI).

import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type {
  EmailAdapter,
  EmailMessage,
  EmailSendResult,
} from './email.types';

@Injectable()
export class MailHogAdapter implements EmailAdapter {
  private readonly log = new Logger(MailHogAdapter.name);
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = createTransport({
      host: process.env.MAILHOG_HOST ?? 'localhost',
      port: Number(process.env.MAILHOG_PORT ?? 1025),
      // MailHog has no auth and no TLS — secure:false disables STARTTLS too.
      secure: false,
      ignoreTLS: true,
    });
    return this.transporter;
  }

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    const from =
      process.env.EMAIL_FROM ?? 'The Owl\'s Nest <noreply@owlsnest.local>';
    const info = await this.getTransporter().sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.idempotencyKey
        ? { 'X-Idempotency-Key': msg.idempotencyKey }
        : undefined,
    });
    this.log.debug(
      { to: msg.to, subject: msg.subject, messageId: info.messageId },
      'mailhog: sent',
    );
    return { id: String(info.messageId ?? `mh_${Date.now()}`), provider: 'mailhog' };
  }
}
