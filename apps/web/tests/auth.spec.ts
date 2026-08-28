import { expect, signIn, test } from './fixtures.js';

/**
 * The half of authentication that no unit test can reach: a real password hash, a real
 * `HttpOnly` refresh cookie crossing from :4173 to :3100, and the token exchange the SPA
 * does on start-up.
 */
test.describe('authentication', () => {
	/**
	 * The organization was installed by the setup project; Beacon holds one per
	 * deployment, so the register screen has nothing left to offer and says so rather
	 * than showing a form whose only possible answer is 409.
	 */
	test('closes the register screen once the instance is installed', async ({ page }) => {
		await page.goto('/register');

		await expect(
			page.getByRole('heading', { level: 1, name: 'Beacon is already set up' })
		).toBeVisible();
		await expect(page.getByLabel('Organization name')).toBeHidden();
		await page.getByRole('link', { name: 'Sign in' }).click();
		await expect(page).toHaveURL('/login');
	});

	test('stops offering to create an organization', async ({ page }) => {
		await page.goto('/login');

		await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Create one' })).toBeHidden();
	});

	/** An invited member signs in with the password they set when accepting. */
	test('signs an invited member in', async ({ page, owner }) => {
		await signIn(page, owner);

		await expect(page.getByText(owner.organizationName)).toBeVisible();
	});

	test('refuses a wrong password', async ({ page, owner }) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill(owner.email);
		await page.getByLabel('Password', { exact: true }).fill('not-the-password');
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page.getByText('That email and password do not match an account.')).toBeVisible();
		await expect(page).toHaveURL('/login');
	});

	/**
	 * The access token lives in memory only, so surviving a reload proves the refresh
	 * cookie was set, sent cross-port, and traded for a new token by `session.bootstrap()`.
	 */
	test('restores the session after a reload', async ({ ownerPage }) => {
		await ownerPage.reload();

		await expect(ownerPage.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
		await expect(ownerPage).toHaveURL('/');
	});

	test('signs out and cannot walk back in', async ({ ownerPage }) => {
		await ownerPage.getByRole('button', { name: 'Sign out' }).click();
		await expect(ownerPage).toHaveURL('/login');

		// The cookie is revoked server-side, so the guard has nothing to restore from.
		await ownerPage.goto('/');
		await expect(ownerPage).toHaveURL('/login');
	});

	test('sends an anonymous visitor to the login screen', async ({ page }) => {
		await page.goto('/timesheet');

		await expect(page).toHaveURL('/login');
		await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
	});
});
