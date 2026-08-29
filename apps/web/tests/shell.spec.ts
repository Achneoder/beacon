import { expect, test } from './fixtures.js';

/**
 * The sidebar is built from `session.can(...)`, and the permission set arrives inside the
 * access token — so this is really a test that the token the API issues carries what the
 * shell expects. An owner holds every permission and therefore sees every entry.
 */
const NAV = [
	{ label: 'Today', url: '/', heading: 'Today' },
	{ label: 'Timesheet', url: '/timesheet', heading: 'Timesheet' },
	{ label: 'Calendar', url: '/calendar', heading: 'Calendar' },
	{ label: 'Documents', url: '/documents', heading: 'Documents' },
	{ label: 'Approvals', url: '/approvals', heading: 'Approvals' },
	{ label: 'Reports', url: '/reports', heading: 'Reports' },
	{ label: 'People', url: '/people', heading: 'People' },
	{ label: 'Settings', url: '/settings/organization', heading: 'Settings' },
	{ label: 'Profile', url: '/profile', heading: 'Profile' }
];

test.describe('app shell', () => {
	test('offers every screen to an owner', async ({ ownerPage }) => {
		const nav = ownerPage.getByRole('navigation', { name: 'Main navigation' });

		for (const { label } of NAV) {
			await expect(nav.getByRole('link', { name: label })).toBeVisible();
		}
	});

	for (const { label, url, heading } of NAV) {
		test(`navigates to ${label}`, async ({ ownerPage }) => {
			const nav = ownerPage.getByRole('navigation', { name: 'Main navigation' });
			await nav.getByRole('link', { name: label }).click();

			await expect(ownerPage).toHaveURL(url);
			await expect(ownerPage.getByRole('heading', { level: 1, name: heading })).toBeVisible();
			// Each screen loads its own data over REST; a failed call surfaces here.
			await expect(ownerPage.getByText('Something went wrong. Please try again.')).toBeHidden();
		});
	}

	test('shows the signed-in owner and their organization', async ({ ownerPage, owner }) => {
		await expect(ownerPage.getByText(owner.organizationName)).toBeVisible();
		await expect(
			ownerPage.getByText(`${owner.firstName} ${owner.lastName}`, { exact: true })
		).toBeVisible();
	});
});
