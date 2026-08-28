import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from './environment.mjs';

/**
 * One organization for the whole run, and a fresh person in it per test.
 *
 * Beacon is installed for a single organization: `POST /auth/register` succeeds once
 * and 409s forever after, so a tenant per spec is no longer available. The `setup`
 * project (`tests/instance.setup.ts`) installs the instance before anything else runs;
 * every test then invites its own account into it, which is what keeps a spec's
 * clock-ins and absences to itself.
 *
 * The e2e database is a tmpfs that dies with the containers, so nothing is cleaned up
 * — and a database left over from a previous run is picked up rather than rejected.
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

/**
 * The installation itself. Fixed rather than unique, so re-running against containers
 * that are already up finds the organization it left there and signs in instead.
 */
export const INSTANCE: Account = {
	organizationName: 'Beacon e2e',
	email: 'owner@beacon.test',
	password: PASSWORD,
	firstName: 'Grace',
	lastName: 'Hopper'
};

/** Installs the instance, or accepts that a previous run already did. */
export async function installInstance(request: APIRequestContext): Promise<void> {
	const response = await request.post(`${API_URL}/auth/register`, { data: INSTANCE });

	expect([201, 409], await response.text()).toContain(response.status());
}

async function accessToken(request: APIRequestContext, account: Account): Promise<string> {
	const response = await request.post(`${API_URL}/auth/login`, {
		data: { email: account.email, password: account.password }
	});
	expect(response.status(), await response.text()).toBe(200);

	return (await response.json()).accessToken;
}

/**
 * Adds a person to the organization through the invitation flow — the only way in now
 * that signup is closed, and the same one a real deployment uses.
 *
 * `roleKey` defaults to `owner` because most specs want every permission; the sidebar
 * and the approvals screen are built from what the access token carries.
 */
export async function inviteMember(
	request: APIRequestContext,
	roleKey = 'owner'
): Promise<Account> {
	const headers = { Authorization: `Bearer ${await accessToken(request, INSTANCE)}` };

	const rolesResponse = await request.get(`${API_URL}/organizations/current/roles`, { headers });
	expect(rolesResponse.status(), await rolesResponse.text()).toBe(200);
	const role = (await rolesResponse.json()).find((it: { key: string }) => it.key === roleKey);
	expect(role, `no ${roleKey} role in the organization`).toBeTruthy();

	const id = crypto.randomUUID().slice(0, 8);
	const account: Account = {
		organizationName: INSTANCE.organizationName,
		email: `member.${id}@beacon.test`,
		password: PASSWORD,
		firstName: 'Ada',
		lastName: 'Lovelace'
	};

	const invited = await request.post(`${API_URL}/invitations`, {
		headers,
		data: {
			email: account.email,
			firstName: account.firstName,
			lastName: account.lastName,
			roleIds: [role.id]
		}
	});
	expect(invited.status(), await invited.text()).toBe(201);

	// The token comes back exactly once, in the creation response — there is no mail
	// seam yet, and this is the same handoff an administrator does by hand.
	const accepted = await request.post(`${API_URL}/invitations/accept`, {
		data: { token: (await invited.json()).token, password: account.password }
	});
	expect(accepted.status(), await accepted.text()).toBe(201);

	return account;
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
	/** A brand-new member of the organization, holding every permission. */
	owner: Account;
	/** A page already signed in as `owner`, sitting on Today. */
	ownerPage: Page;
}>({
	owner: async ({ request }, use) => {
		await use(await inviteMember(request));
	},

	ownerPage: async ({ page, owner }, use) => {
		await signIn(page, owner);
		await use(page);
	}
});

export { expect };
