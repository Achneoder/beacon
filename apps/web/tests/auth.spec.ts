import { expect, signIn, test } from './fixtures.js';

/**
 * The half of authentication that no unit test can reach: a real password hash, a real
 * `HttpOnly` refresh cookie crossing from :4173 to :3100, and the token exchange the SPA
 * does on start-up.
 */
test.describe('authentication', () => {
	test('creates an organization and lands in the app', async ({ page, account }) => {
		await page.goto('/register');

		await page.getByLabel('Organization name').fill(account.organizationName);
		await page.getByLabel('First name').fill(account.firstName);
		await page.getByLabel('Last name').fill(account.lastName);
		await page.getByLabel('Email address').fill(account.email);
		await page.getByLabel('Password', { exact: true }).fill(account.password);
		await page.getByLabel('Confirm password').fill(account.password);
		await page.getByRole('button', { name: 'Create organization' }).click();

		await expect(page).toHaveURL('/');
		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
		// The owner's own tenant, read back from the session the API issued.
		await expect(page.getByText(account.organizationName)).toBeVisible();
	});

	test('refuses a wrong password', async ({ page, owner }) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill(owner.email);
		await page.getByLabel('Password', { exact: true }).fill('not-the-password');
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page.getByText('That email and password do not match an account.')).toBeVisible();
		await expect(page).toHaveURL('/login');
	});

	test('signs an existing owner in', async ({ page, owner }) => {
		await signIn(page, owner);

		await expect(page.getByText(owner.organizationName)).toBeVisible();
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
