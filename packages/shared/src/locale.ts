/**
 * The languages Beacon ships copy for. The web app's dictionaries
 * (`apps/web/src/lib/i18n/locales/`) and the invitation email cover exactly these,
 * so anything outside the list is not a language anyone would ever see — which is
 * why the settings and profile DTOs validate against it instead of taking any
 * string. A free-text locale that silently did nothing is what made the
 * organization's default language look broken.
 */
export const SUPPORTED_LOCALES = ['en', 'de'] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

/** The language a Beacon with nothing configured speaks. */
export const FALLBACK_LOCALE: LocaleCode = 'en';

/**
 * The first supported language among the preferences given, `en` if none match.
 *
 * Preferences are read in order, so the resolution rule reads as the sentence it is:
 * `resolveLocale(user.locale, organization.defaultLocale)` — the person's own choice
 * when they made one, the organization's default otherwise. A regional tag matches
 * its base language (`de-DE` → `de`), which is what makes `navigator.language` a
 * usable preference.
 */
export function resolveLocale(...preferences: (string | null | undefined)[]): LocaleCode {
  for (const preference of preferences) {
    const match = matchLocale(preference);
    if (match) return match;
  }

  return FALLBACK_LOCALE;
}

function matchLocale(value: string | null | undefined): LocaleCode | null {
  const base = value?.trim().slice(0, 2).toLowerCase();

  return SUPPORTED_LOCALES.find((locale) => locale === base) ?? null;
}
