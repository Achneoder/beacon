import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MailService, type MailMessage } from './mail.service.js';

/**
 * The fallback when no SMTP host is configured. Nothing leaves the process — `send`
 * reports false so callers surface the link themselves instead of promising an email.
 *
 * **The body is not logged.** An invitation email carries the accept link, and that
 * link carries the raw token — a live credential that creates an active account with
 * whatever roles the invitation was given. The token is deliberately stored only as a
 * SHA-256 digest so that not even an administrator reading the table can recover it
 * (`invitations.service.ts`); writing it to the log in plaintext handed it straight
 * back, to a log store whose readership is usually wider than the database's and whose
 * retention outlives the 14-day token. Subject and recipient are enough to see that a
 * message was produced.
 *
 * `MAIL_LOG_BODY=true` opts back in for local debugging. It is off by default and
 * belongs nowhere near an installation with real invitations in it.
 */
@Injectable()
export class LogMailService extends MailService {
  private readonly logger = new Logger(LogMailService.name);
  private readonly logBody: boolean;

  constructor(config?: ConfigService) {
    super();
    this.logBody = config?.get<string>('MAIL_LOG_BODY') === 'true';
  }

  async send(message: MailMessage): Promise<boolean> {
    const line = `no MAIL_HOST configured — dropping "${message.subject}" to ${message.to}`;
    // The body can hold a credential, so it is only ever logged behind the opt-in.
    this.logger.warn(this.logBody ? `${line}\n${message.text}` : line);

    return false;
  }
}
