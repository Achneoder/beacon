import { expect, inviteMember, test } from './fixtures.js';
import { startStubIdp, type StubIdp } from './sso-idp-stub.js';

/**
 * SSO gets its own project (see `playwright.config.ts`), running alone after every
 * other spec: it is the only file that flips the shared organization's SSO settings,
 * and `fullyParallel` would otherwise race a password sign-in in another spec against
 * this one hiding the password form under enforcement.
 *
 * What this proves: the settings screen's save-and-discover round trip against a real
 * API and a real (if minimal) issuer, the login screen offering the button once
 * enabled, the password form disappearing under enforcement, and the admin escape
 * hatch. The redirect chain itself — state, nonce, PKCE, the callback, invitation
 * acceptance on first login — is `apps/api/test/sso.e2e-spec.ts`'s job, against a fake
 * IdP that actually signs ID tokens; see `ROADMAP.md`'s SSO phase.
 */
test.describe.serial('sso', () => {
	let idp: StubIdp;

	test.beforeAll(async () => {
		idp = await startStubIdp();
	});

	test.afterAll(async () => {
		await idp.stop();
	});

	test('an admin configures a provider, and the login screen offers it', async ({
		page,
		owner
	}) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill(owner.email);
		await page.getByLabel('Password', { exact: true }).fill(owner.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

		await page.goto('/settings/sso');
		await page.getByLabel('Button label').fill('Okta');
		await page.getByLabel('Issuer URL').fill(idp.issuerUrl);
		await page.getByLabel('Client ID').fill('beacon-client');
		await page.getByLabel('Client secret').fill('beacon-client-secret');
		await page.getByLabel('Enabled').check();
		await page.getByRole('button', { name: 'Save' }).click();

		await expect(page.getByText('Single sign-on settings saved.')).toBeVisible();
		await expect(page.getByText(/\/api\/auth\/sso\/callback$/)).toBeVisible();

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL('/login');
		await expect(page.getByRole('button', { name: 'Sign in with Okta' })).toBeVisible();
		// The password form stays put — nothing is enforced yet.
		await expect(page.getByLabel('Email address')).toBeVisible();
	});

	test('enforcing sso hides the password form, with an escape hatch for admins', async ({
		page,
		owner
	}) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill(owner.email);
		await page.getByLabel('Password', { exact: true }).fill(owner.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

		await page.goto('/settings/sso');
		// The provider the previous test saved is still there — this organization is
		// shared for the whole run.
		await expect(page.getByLabel('Button label')).toHaveValue('Okta');
		await page.getByLabel('Require single sign-on').check();
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Single sign-on settings saved.')).toBeVisible();

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL('/login');

		await expect(page.getByRole('button', { name: 'Sign in with Okta' })).toBeVisible();
		await expect(page.getByLabel('Email address')).toBeHidden();

		await page.getByRole('link', { name: 'Sign in with a password instead' }).click();
		await expect(page).toHaveURL('/login?password=1');
		await expect(page.getByLabel('Email address')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Sign in with a password instead' })).toBeHidden();
	});

	test('an ordinary member can no longer sign in with a password once enforced', async ({
		page,
		request
	}) => {
		const member = await inviteMember(request, 'employee');

		await page.goto('/login?password=1');
		await page.getByLabel('Email address').fill(member.email);
		await page.getByLabel('Password', { exact: true }).fill(member.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(
			page.getByText('Your organization signs in through single sign-on.')
		).toBeVisible();
		await expect(page).toHaveURL('/login?password=1');
	});

	test('the admin exemption still signs in with a password once enforced', async ({
		page,
		owner
	}) => {
		await page.goto('/login?password=1');
		await page.getByLabel('Email address').fill(owner.email);
		await page.getByLabel('Password', { exact: true }).fill(owner.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

		// Leave the installation clean for anyone re-running just this file locally.
		await page.goto('/settings/sso');
		page.once('dialog', (dialog) => void dialog.accept());
		await page.getByRole('button', { name: 'Remove provider' }).click();
		await expect(page.getByText('No provider is configured yet.')).toBeVisible();
	});
});
