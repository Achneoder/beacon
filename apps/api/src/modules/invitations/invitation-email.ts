import { INVITATION_TTL_DAYS } from './invitation-token.js';
import type { MailMessage } from '../../common/mail/mail.service.js';

export interface InvitationEmailInput {
  email: string;
  firstName: string;
  organizationName: string;
  invitedByName: string | null;
  acceptUrl: string;
  /**
   * The language to write in — already resolved by the caller against the invitation
   * and then the organization's default. Anything unrecognised still falls back to `en`.
   */
  locale: string;
  expiresInDays?: number;
}

/**
 * Copy lives here rather than in a template engine: two locales and one message do not
 * justify a renderer, and a pure function is the part worth testing.
 *
 * The invitee has no account yet, so the API cannot read a preference — the locale is
 * whatever the inviter chose on the invitation, and the organization's default when
 * they chose nothing.
 */
const COPY = {
  en: {
    subject: (organization: string) => `You have been invited to ${organization} on Beacon`,
    greeting: (firstName: string) => `Hi ${firstName},`,
    invitedBy: (organization: string, invitedBy: string | null) =>
      invitedBy
        ? `${invitedBy} has invited you to join ${organization} on Beacon.`
        : `You have been invited to join ${organization} on Beacon.`,
    action: 'Set your password and finish signing up:',
    button: 'Accept the invitation',
    expiry: (days: number) =>
      `The link expires in ${days} days. If you were not expecting this, you can ignore this email.`,
  },
  de: {
    subject: (organization: string) => `Sie wurden zu ${organization} auf Beacon eingeladen`,
    greeting: (firstName: string) => `Hallo ${firstName},`,
    invitedBy: (organization: string, invitedBy: string | null) =>
      invitedBy
        ? `${invitedBy} hat Sie eingeladen, ${organization} auf Beacon beizutreten.`
        : `Sie wurden eingeladen, ${organization} auf Beacon beizutreten.`,
    action: 'Vergeben Sie ein Passwort und schließen Sie die Anmeldung ab:',
    button: 'Einladung annehmen',
    expiry: (days: number) =>
      `Der Link läuft in ${days} Tagen ab. Falls Sie diese E-Mail nicht erwartet haben, können Sie sie ignorieren.`,
  },
} as const;

export type InvitationEmailLocale = keyof typeof COPY;

export function invitationEmail(input: InvitationEmailInput): MailMessage {
  const copy = COPY[localeOf(input.locale)];
  const days = input.expiresInDays ?? INVITATION_TTL_DAYS;
  const lines = [
    copy.greeting(input.firstName),
    '',
    copy.invitedBy(input.organizationName, input.invitedByName),
    '',
    copy.action,
    input.acceptUrl,
    '',
    copy.expiry(days),
  ];

  return {
    to: input.email,
    subject: copy.subject(input.organizationName),
    text: lines.join('\n'),
    html: html(copy, input, days),
  };
}

function localeOf(locale: string): InvitationEmailLocale {
  const base = locale.slice(0, 2).toLowerCase();

  return base in COPY ? (base as InvitationEmailLocale) : 'en';
}

/**
 * Inline styles and a table-free single column: mail clients strip stylesheets, and the
 * link is repeated as text because some of them refuse to render the button at all.
 */
function html(
  copy: (typeof COPY)[InvitationEmailLocale],
  input: InvitationEmailInput,
  days: number,
): string {
  const url = escape(input.acceptUrl);

  return `<!doctype html>
<html lang="${localeOf(input.locale)}">
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:system-ui,sans-serif;color:#1c1917;">
    <div style="max-width:520px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
      <p style="margin:0 0 16px;">${escape(copy.greeting(input.firstName))}</p>
      <p style="margin:0 0 16px;">${escape(copy.invitedBy(input.organizationName, input.invitedByName))}</p>
      <p style="margin:0 0 24px;">${escape(copy.action)}</p>
      <p style="margin:0 0 24px;">
        <a href="${url}" style="display:inline-block;padding:12px 20px;background:#1c1917;color:#ffffff;border-radius:8px;text-decoration:none;">${escape(copy.button)}</a>
      </p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:13px;color:#57534e;">${url}</p>
      <p style="margin:0;font-size:13px;color:#57534e;">${escape(copy.expiry(days))}</p>
    </div>
  </body>
</html>`;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
