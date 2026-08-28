import { Injectable, Logger } from '@nestjs/common';
import { MailService, type MailMessage } from './mail.service.js';

/**
 * The fallback when no SMTP host is configured. Nothing leaves the process — the
 * message is logged so a developer can still see what would have been sent, and
 * `send` reports false so callers surface the link instead of promising an email.
 */
@Injectable()
export class LogMailService extends MailService {
  private readonly logger = new Logger(LogMailService.name);

  async send(message: MailMessage): Promise<boolean> {
    this.logger.warn(
      `no MAIL_HOST configured — dropping "${message.subject}" to ${message.to}\n${message.text}`,
    );

    return false;
  }
}
