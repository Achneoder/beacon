import { describe, expect, it } from 'vitest';
import { LANGUAGES, messageKeys, t, toLanguage } from './locales.js';

describe('the native copy', () => {
  it('carries the same keys in every language', () => {
    // The guarantee `invitation-email.spec.ts` makes for the mail copy. `t` falls back
    // to English for a missing key, so without this a forgotten German string would
    // ship silently rather than fail.
    for (const language of LANGUAGES) {
      expect(messageKeys(language)).toEqual(messageKeys('en'));
    }
  });

  it('actually translates, rather than repeating the English', () => {
    for (const key of ['tray.open', 'tray.quit', 'setup.title', 'error.title'] as const) {
      expect(t('de', key)).not.toBe(t('en', key));
    }
  });

  it('substitutes into a message', () => {
    expect(t('en', 'error.body', { url: 'https://beacon.example.com' })).toContain(
      'https://beacon.example.com',
    );
  });

  it('leaves an unfilled placeholder alone rather than printing "undefined"', () => {
    expect(t('en', 'error.body', {})).toContain('{url}');
  });

  it('narrows what the OS reports to a language it carries', () => {
    expect(toLanguage('de-AT')).toBe('de');
    expect(toLanguage('en-GB')).toBe('en');
    expect(toLanguage('fr-FR')).toBe('en');
    expect(toLanguage(null)).toBe('en');
  });
});
