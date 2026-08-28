import { browser } from '$app/environment';
import { init, register, locale } from 'svelte-i18n';

const FALLBACK_LOCALE = 'en';

register('en', () => import('./locales/en.json'));
register('de', () => import('./locales/de.json'));

init({
	fallbackLocale: FALLBACK_LOCALE,
	initialLocale: browser ? window.navigator.language : FALLBACK_LOCALE
});

export { locale };
