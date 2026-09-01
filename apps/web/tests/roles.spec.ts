import { expect, inviteMember, signIn, test } from './fixtures.js';

/**
 * The role editor through the real SPA and API — what neither the component test (a
 * mocked client) nor the API e2e suite (no browser) can show: the `RoleSummary` shape
 * agreeing at runtime, and `organization:manage` inside the access token being what
 * opens the screen.
 *
 * Every test works on a role of its own, named uniquely, and cleans it up. The
 * organization is shared by the whole run — `fullyParallel` is on — so nothing here
 * touches a built-in role: editing `manager` would change what another spec's account
 * is allowed to do, mid-flight.
 */
const roleName = () => `Auditor ${crypto.randomUUID().slice(0, 8)}`;

/** The card a role is rendered in. */
const card = (page: import('@playwright/test').Page, name: string) =>
	page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });

test.describe('roles', () => {
	test('creates a role, edits it, and deletes it again', async ({ ownerPage }) => {
		const name = roleName();

		await ownerPage.goto('/settings/roles');
		await expect(ownerPage.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();

		await ownerPage.getByRole('button', { name: 'New role' }).click();
		const form = card(ownerPage, 'New role');
		await form.getByLabel('Role name').fill(name);
		await form.getByRole('checkbox', { name: 'See reports' }).check();
		await form.getByRole('button', { name: 'Create role' }).click();

		await expect(ownerPage.getByText('Role created.')).toBeVisible();
		const created = card(ownerPage, name);
		await expect(created.getByText('See reports')).toBeVisible();
		await expect(created.getByText('Nobody holds this role')).toBeVisible();

		// Editing replaces the permission list wholesale, name included.
		await created.getByRole('button', { name: 'Edit' }).click();
		await created.getByRole('checkbox', { name: 'See documents' }).check();
		await created.getByRole('button', { name: 'Save role' }).click();

		await expect(ownerPage.getByText('Role saved.')).toBeVisible();
		await expect(created.getByText('See documents')).toBeVisible();

		await created.getByRole('button', { name: 'Delete' }).click();
		await expect(ownerPage.getByText('Role deleted.')).toBeVisible();
		await expect(card(ownerPage, name)).toHaveCount(0);
	});

	test('never offers to edit the owner role', async ({ ownerPage }) => {
		await ownerPage.goto('/settings/roles');

		const owner = card(ownerPage, 'Owner');
		await expect(owner.getByText(/always holds every permission/)).toBeVisible();
		await expect(owner.getByRole('button', { name: 'Edit' })).toHaveCount(0);
	});

	test('is reached from the organization settings screen', async ({ ownerPage }) => {
		await ownerPage.goto('/settings/organization');
		await ownerPage.getByRole('link', { name: 'Manage roles' }).click();

		await expect(ownerPage).toHaveURL('/settings/roles');
		await expect(ownerPage.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();
	});

	test('refuses the screen to somebody without organization:manage', async ({ page, request }) => {
		const manager = await inviteMember(request, 'manager');
		await signIn(page, manager);

		// The API is the enforcement — the list itself needs organization:read, which a
		// manager does not hold, so the screen can only report the refusal.
		await page.goto('/settings/roles');
		await expect(page.getByText('You do not have access to that.')).toBeVisible();
	});
});
