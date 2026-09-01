import { browser } from '$app/environment';
import { FALLBACK_LOCALE, resolveLocale } from '@beacon/shared';
import { init, register, locale } from 'svelte-i18n';

register('en', () => import('./locales/en.json'));
register('de', () => import('./locales/de.json'));

/**
 * Before anyone signs in — the login, register and invitation screens — the browser's
 * own preference is the only signal there is. `SessionState.adopt` replaces it with the
 * language the API resolved for the account, which is the user's own choice when they
 * made one and the organization's `defaultLocale` when they did not.
 */
init({
	fallbackLocale: FALLBACK_LOCALE,
	initialLocale: browser ? resolveLocale(window.navigator.language) : FALLBACK_LOCALE
});

export { locale };
