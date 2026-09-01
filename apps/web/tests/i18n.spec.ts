import { expect, test } from './fixtures.js';
import { API_URL } from './environment.mjs';

/**
 * The language is resolved by the API — the person's own choice when they made one,
 * the organization's `defaultLocale` when they did not — and the SPA renders whatever
 * `SessionUser.locale` says. Neither half is provable on its own: the API e2e suite
 * asserts the resolution, the web unit tests assert that the session drives
 * `svelte-i18n`, and only here do the built SPA and a real API meet.
 *
 * This spec changes nothing but its own account's preference. The organization's
 * default is deliberately left alone: every other spec's person follows it, and
 * flipping it under `fullyParallel` would rewrite their screens mid-test.
 */
test.describe('language', () => {
	test('renders in the language the account resolved to', async ({ page, owner, request }) => {
		const login = await request.post(`${API_URL}/auth/login`, {
			data: { email: owner.email, password: owner.password }
		});
		expect(login.status(), await login.text()).toBe(200);

		const chosen = await request.patch(`${API_URL}/users/me`, {
			headers: { Authorization: `Bearer ${(await login.json()).accessToken}` },
			data: { locale: 'de' }
		});
		expect(chosen.status(), await chosen.text()).toBe(200);

		// Signed in through the form, so the language arrives the way it does in
		// production: on the auth response, before the first guarded screen renders.
		// The login screen itself is still English — nobody has said who is signing in.
		await page.goto('/login');
		await page.getByLabel('Email address').fill(owner.email);
		await page.getByLabel('Password', { exact: true }).fill(owner.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
		const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await expect(nav.getByRole('link', { name: 'Personen' })).toBeVisible();
		// Not a stale English frame repainted a moment later: the root layout gates its
		// first render on the session, so 'Today' was never on screen.
		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeHidden();
	});

	test('offers the organization default as a choice, not free text', async ({ ownerPage }) => {
		// A text box accepted 'de-DE', or a typo, and saved it cleanly — which is what
		// made the setting look broken. The options are the languages that exist.
		await ownerPage.goto('/settings/organization');

		const field = ownerPage.getByLabel('Default language');
		await expect(field.getByRole('option')).toHaveText(['English', 'German']);
	});

	test('picks the organization zone from a list, keeping the saved one selected', async ({
		ownerPage
	}) => {
		// The zone is the other half of the same bug: `Europe/Berlon` also saved
		// cleanly, and then put every clock-in on a clock nobody works to. The
		// installation starts on UTC, which some ICU builds leave out of the
		// enumeration — so the picker has to still offer it, or opening this form
		// would move the organization off it on the next save.
		await ownerPage.goto('/settings/organization');

		const field = ownerPage.getByLabel('Time zone');
		await expect(field).toHaveValue('UTC');
		await expect(field.getByRole('option', { name: 'Berlin', exact: true })).toBeAttached();
	});
});
