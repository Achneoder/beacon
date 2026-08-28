import { describe, expect, it } from 'vitest';
import { invitationEmail } from './invitation-email.js';

const base = {
  email: 'alan@acme.test',
  firstName: 'Alan',
  organizationName: 'Acme',
  invitedByName: 'Ada Lovelace',
  acceptUrl: 'http://localhost:5173/invite/abc',
  locale: 'en',
};

describe('invitationEmail', () => {
  it('addresses the invitee and carries the link in both parts', () => {
    const message = invitationEmail(base);

    expect(message.to).toBe('alan@acme.test');
    expect(message.subject).toBe('You have been invited to Acme on Beacon');
    expect(message.text).toContain('Hi Alan,');
    expect(message.text).toContain('Ada Lovelace has invited you');
    expect(message.text).toContain(base.acceptUrl);
    expect(message.html).toContain(`href="${base.acceptUrl}"`);
  });

  it('writes in the invitee’s locale', () => {
    const message = invitationEmail({ ...base, locale: 'de' });

    expect(message.subject).toBe('Sie wurden zu Acme auf Beacon eingeladen');
    expect(message.text).toContain('Hallo Alan,');
  });

  it('falls back to English for a locale it has no copy for', () => {
    expect(invitationEmail({ ...base, locale: 'fr-CA' }).text).toContain('Hi Alan,');
    // A region on a locale it does know still resolves.
    expect(invitationEmail({ ...base, locale: 'de-AT' }).text).toContain('Hallo Alan,');
  });

  it('drops the inviter from the copy when the invitation has none', () => {
    const message = invitationEmail({ ...base, invitedByName: null });

    expect(message.text).toContain('You have been invited to join Acme');
    expect(message.text).not.toContain('undefined');
  });

  it('escapes the organization name rather than injecting it into the markup', () => {
    const message = invitationEmail({ ...base, organizationName: 'Acme <script>' });

    expect(message.html).toContain('Acme &lt;script&gt;');
    expect(message.html).not.toContain('<script>');
  });

  it('names the expiry the token actually has', () => {
    expect(invitationEmail(base).text).toContain('expires in 14 days');
  });
});
