import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { Permission, SessionUser } from '@beacon/shared';
import '$lib/i18n';
import Sidebar from './Sidebar.svelte';
import { session } from '$lib/auth/session.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));

const user: SessionUser = {
	id: 'u1',
	email: 'lena@acme.test',
	organizationId: 'o1',
	permissions: [],
	firstName: 'Lena',
	lastName: 'Hartmann',
	locale: 'en',
	timezone: null,
	jobTitle: null,
	roleKeys: ['employee'],
	organizationName: 'Acme GmbH',
	organizationSlug: 'acme'
};

function renderSidebar(permissions: Permission[]) {
	vi.spyOn(session, 'can').mockImplementation((p) => permissions.includes(p));
	return render(Sidebar, { props: { user, clockState: 'out', onSignOut: () => {} } });
}

beforeEach(async () => {
	vi.restoreAllMocks();
	await waitLocale('en');
});

describe('Sidebar', () => {
	it('names the organization and the navigation landmark', () => {
		renderSidebar(['attendance:read']);

		expect(screen.getByText('Acme GmbH')).toBeInTheDocument();
		expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
	});

	it('offers Today to someone who may read attendance', () => {
		renderSidebar(['attendance:read']);

		const today = screen.getByRole('link', { name: 'Today' });
		expect(today).toHaveAttribute('href', '/');
		// The URL mock puts us on `/`, so Today is the current page.
		expect(today).toHaveAttribute('aria-current', 'page');
	});

	it('offers Approvals to an approver who never books time of their own', () => {
		// The default `manager` role: it approves, and holds no `attendance:write`.
		renderSidebar(['attendance:read', 'attendance:approve', 'holiday:approve']);

		expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
	});

	it('hides a screen the account has no permission for', () => {
		renderSidebar([]);

		expect(screen.queryByRole('link', { name: 'Today' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'People' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
	});

	it('always offers Profile — nothing gates your own account', () => {
		renderSidebar([]);

		expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
	});

	it('adds People and Settings for the permissions that make them useful', () => {
		renderSidebar(['employee:read', 'organization:manage']);

		expect(screen.getByRole('link', { name: 'People' })).toHaveAttribute('href', '/people');
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
			'href',
			'/settings/organization'
		);
	});

	it('shows the clock state, the appearance setting and the user', () => {
		renderSidebar(['attendance:read']);

		expect(screen.getByText('Clocked out')).toBeInTheDocument();
		expect(screen.getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
		expect(screen.getByText('Lena Hartmann')).toBeInTheDocument();
		// No job title is recorded, so the primary role stands in for it.
		expect(screen.getByText('Employee')).toBeInTheDocument();
	});

	it('prefers the job title over the role once one is recorded', () => {
		vi.spyOn(session, 'can').mockReturnValue(true);
		render(Sidebar, {
			props: {
				user: { ...user, jobTitle: 'Product Designer' },
				clockState: 'out',
				onSignOut: () => {}
			}
		});

		expect(screen.getByText('Product Designer')).toBeInTheDocument();
		expect(screen.queryByText('Employee')).not.toBeInTheDocument();
	});

	it('signs out through the caller', async () => {
		const onSignOut = vi.fn();
		vi.spyOn(session, 'can').mockReturnValue(true);
		render(Sidebar, { props: { user, clockState: 'out', onSignOut } });

		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

		expect(onSignOut).toHaveBeenCalledOnce();
	});
});
