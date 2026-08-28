import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from './environment.mjs';

/**
 * Every spec works in an organization it created itself.
 *
 * Beacon is multi-tenant and self-service signup is open, so a fresh tenant per test is
 * both cheap and the most faithful setup available — no fixtures file to drift from the
 * migrations, no shared account for tests to trip over in parallel. The e2e database is
 * a tmpfs that dies with the containers, so nothing is cleaned up afterwards.
 */
export type Account = {
	organizationName: string;
	email: string;
	password: string;
	firstName: string;
	lastName: string;
};

/** Long enough for the API's 12-character minimum, and the same for every account. */
const PASSWORD = 'correct-horse-battery';

export function uniqueAccount(): Account {
	const id = crypto.randomUUID().slice(0, 8);

	return {
		organizationName: `Acme ${id}`,
		email: `owner.${id}@acme.test`,
		password: PASSWORD,
		firstName: 'Ada',
		lastName: 'Lovelace'
	};
}

/**
 * Registration through the API rather than the UI: the register *screen* is the subject
 * of exactly one spec, and everywhere else it is setup that should not cost a page load.
 */
export async function registerAccount(request: APIRequestContext, account: Account): Promise<void> {
	const response = await request.post(`${API_URL}/auth/register`, { data: account });

	expect(response.status(), await response.text()).toBe(201);
}

/** Signs in through the form and waits for the app shell to have rendered. */
export async function signIn(page: Page, account: Account): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Email address').fill(account.email);
	await page.getByLabel('Password', { exact: true }).fill(account.password);
	await page.getByRole('button', { name: 'Sign in' }).click();

	await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
}

export const test = base.extend<{
	/** A unique, *unregistered* account — for specs that exercise signup itself. */
	account: Account;
	/** The owner of a freshly created organization: every permission, nobody else in it. */
	owner: Account;
	/** A page already signed in as `owner`, sitting on Today. */
	ownerPage: Page;
}>({
	// eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature.
	account: async ({}, use) => {
		await use(uniqueAccount());
	},

	owner: async ({ request, account }, use) => {
		await registerAccount(request, account);
		await use(account);
	},

	ownerPage: async ({ page, owner }, use) => {
		await signIn(page, owner);
		await use(page);
	}
});

export { expect };
