import { describe, expect, it } from 'vitest';
import { FALLBACK_LOCALE, resolveLocale } from './locale.js';

describe('resolveLocale', () => {
  it('takes the first preference it has copy for', () => {
    expect(resolveLocale('de', 'en')).toBe('de');
    expect(resolveLocale('en', 'de')).toBe('en');
  });

  it('falls through a preference nobody chose', () => {
    // The shape the fix turns on: a user with no locale of their own follows the
    // organization's default instead of being pinned to English.
    expect(resolveLocale(null, 'de')).toBe('de');
    expect(resolveLocale(undefined, 'de')).toBe('de');
    expect(resolveLocale('', 'de')).toBe('de');
  });

  it('matches a regional tag to its base language', () => {
    expect(resolveLocale('de-DE')).toBe('de');
    expect(resolveLocale('de-AT')).toBe('de');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('DE')).toBe('de');
  });

  it('skips a language this installation cannot render', () => {
    expect(resolveLocale('fr', 'de')).toBe('de');
    expect(resolveLocale('German', 'de')).toBe('de');
  });

  it('ends at the fallback when nothing matches', () => {
    expect(resolveLocale()).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(null, null)).toBe(FALLBACK_LOCALE);
    expect(resolveLocale('fr', 'ja')).toBe(FALLBACK_LOCALE);
  });
});

