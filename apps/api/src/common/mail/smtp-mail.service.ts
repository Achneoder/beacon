import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { MailService, type MailMessage } from './mail.service.js';

/**
 * Default implementation, backed by the Mailpit service in infra/docker-compose.yml
 * during development and by whatever relay MAIL_HOST names in production.
 */
@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger(SmtpMailService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    const user = config.get<string>('MAIL_USER');
    const pass = config.get<string>('MAIL_PASSWORD');

    this.from = config.get<string>('MAIL_FROM') ?? 'Beacon <beacon@localhost>';
    this.transport = createTransport({
      host: config.getOrThrow<string>('MAIL_HOST'),
      port: Number(config.get('MAIL_PORT') ?? 1025),
      // Mailpit and most local relays speak plain SMTP on 1025 and offer no
      // certificate, so neither TLS nor authentication can be required here.
      secure: config.get('MAIL_SECURE') === 'true',
      auth: user ? { user, pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<boolean> {
    try {
      await this.transport.sendMail({ ...message, from: this.from });

      return true;
    } catch (error) {
      // Delivery is best-effort by contract: the caller's work is already committed.
      this.logger.error(`could not send "${message.subject}" to ${message.to}`, error);

      return false;
    }
  }
}
