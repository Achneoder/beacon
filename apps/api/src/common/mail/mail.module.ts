import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogMailService } from './log-mail.service.js';
import { MailService } from './mail.service.js';
import { SmtpMailService } from './smtp-mail.service.js';

/**
 * MAIL_HOST is what decides: configured, mail goes over SMTP; absent, it is logged and
 * dropped. Chosen once at boot rather than per message, so a deployment that means to
 * send email fails loudly at startup on a bad host instead of silently per invitation.
 */
@Global()
@Module({
  providers: [
    {
      provide: MailService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('MAIL_HOST') ? new SmtpMailService(config) : new LogMailService(),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
