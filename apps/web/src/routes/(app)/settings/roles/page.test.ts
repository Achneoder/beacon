import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import { PERMISSIONS, type RoleSummary } from '@beacon/shared';
import '$lib/i18n';
import RolesPage from './+page.svelte';
import * as roles from '$lib/api/roles';
import { session } from '$lib/auth/session.svelte';

const owner: RoleSummary = {
	id: 'r-owner',
	key: 'owner',
	name: 'owner',
	permissions: [...PERMISSIONS],
	isSystem: true,
	customized: false,
	memberCount: 1
};

const employee: RoleSummary = {
	id: 'r-employee',
	key: 'employee',
	name: 'employee',
	permissions: ['attendance:read', 'attendance:write', 'holiday:request', 'document:read'],
	isSystem: true,
	customized: false,
	memberCount: 12
};

const payroll: RoleSummary = {
	id: 'r-payroll',
	key: 'payroll',
	name: 'Payroll',
	permissions: ['report:read'],
	isSystem: false,
	customized: false,
	memberCount: 0
};

/** An administrator: `organization:manage`, but none of the self-service permissions. */
const ADMIN = [
	'organization:read',
	'organization:manage',
	'employee:read',
	'employee:manage',
	'attendance:read',
	'attendance:approve',
	'holiday:approve',
	'document:read',
	'document:manage',
	'report:read'
];

function grant(...permissions: string[]) {
	vi.spyOn(session, 'can').mockImplementation((p) => permissions.includes(p));
}

/** The card a role is rendered in, as a query root. */
const card = (name: string) =>
	screen.getByRole('heading', { name, level: 2 }).closest('section') as HTMLElement;

const checkbox = (root: HTMLElement, label: string) =>
	within(root).getByRole('checkbox', { name: label }) as HTMLInputElement;

beforeEach(async () => {
	await waitLocale('en');
	grant(...ADMIN);
	vi.spyOn(roles, 'listRoles').mockResolvedValue([owner, employee, payroll]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const untilLoaded = () => waitFor(() => expect(card('Payroll')).toBeInTheDocument());

describe('roles settings page', () => {
	it('lists every role with its permissions in words, not identifiers', async () => {
		render(RolesPage);
		await untilLoaded();

		expect(within(card('Payroll')).getByText('See reports')).toBeInTheDocument();
		// Built-in roles are shown under their translated name, custom ones under their own.
		expect(card('Employee')).toBeInTheDocument();
		expect(within(card('Employee')).getByText('12 people hold this role')).toBeInTheDocument();
		expect(within(card('Payroll')).getByText('Nobody holds this role')).toBeInTheDocument();
	});

	it('offers no edit for the owner role, and says why', async () => {
		render(RolesPage);
		await untilLoaded();

		const ownerCard = card('Owner');
		expect(within(ownerCard).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
		expect(within(ownerCard).getByText(/always holds every permission/)).toBeInTheDocument();
	});

	it('refuses to delete a role people still hold', async () => {
		// The API refuses it with a 409 rather than cascading through `user_roles`, so
		// the button says so up front instead of offering a click that cannot work.
		vi.mocked(roles.listRoles).mockResolvedValue([owner, { ...payroll, memberCount: 3 }]);

		render(RolesPage);
		await untilLoaded();

		const held = card('Payroll');
		expect(within(held).getByRole('button', { name: 'Delete' })).toBeDisabled();
		expect(within(held).getByText(/Give those people another role/)).toBeInTheDocument();
	});

	it('deletes a role nobody holds', async () => {
		const deleted = vi.spyOn(roles, 'deleteRole').mockResolvedValue(undefined);

		render(RolesPage);
		await untilLoaded();

		await fireEvent.click(within(card('Payroll')).getByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(deleted).toHaveBeenCalledWith('r-payroll'));
		expect(await screen.findByText('Role deleted.')).toBeInTheDocument();
	});

	it('creates a role from the name and the checked permissions', async () => {
		const created = vi.spyOn(roles, 'createRole').mockResolvedValue({
			id: 'r-new',
			key: 'auditor',
			name: 'Auditor',
			permissions: ['report:read', 'document:read'],
			isSystem: false,
			customized: false,
			memberCount: 0
		});

		render(RolesPage);
		await untilLoaded();

		await fireEvent.click(screen.getByRole('button', { name: 'New role' }));
		const form = card('New role');

		await fireEvent.input(within(form).getByLabelText('Role name'), {
			target: { value: 'Auditor' }
		});
		await fireEvent.click(checkbox(form, 'See reports'));
		await fireEvent.click(checkbox(form, 'See documents'));
		await fireEvent.click(within(form).getByRole('button', { name: 'Create role' }));

		await waitFor(() =>
			expect(created).toHaveBeenCalledWith({
				name: 'Auditor',
				permissions: ['report:read', 'document:read']
			})
		);
		expect(await screen.findByText('Role created.')).toBeInTheDocument();
	});

	/**
	 * The permissions the API would refuse are not offered. `assertGrantable` lets a
	 * caller hand out the self-service permissions they lack, so those stay checkable —
	 * an administrator holds none of them and still maintains the employee role.
	 */
	it('disables a permission the caller does not hold, but not a self-service one', async () => {
		// Somebody holding organization:manage and nothing else worth having: they reach
		// this screen, and `assertGrantable` would refuse them document:manage.
		grant('organization:read', 'organization:manage');

		render(RolesPage);
		await untilLoaded();

		await fireEvent.click(screen.getByRole('button', { name: 'New role' }));
		const form = card('New role');

		expect(checkbox(form, 'Manage every document')).toBeDisabled();
		expect(within(form).getAllByText(/You do not hold this permission/).length).toBeGreaterThan(0);
		// Self-service survives: nobody with organization:manage holds these either, and
		// an administrator still has to be able to define an ordinary employee's role.
		expect(checkbox(form, 'Clock in and out')).not.toBeDisabled();
		expect(checkbox(form, 'Request time off')).not.toBeDisabled();
		expect(checkbox(form, 'Upload documents')).not.toBeDisabled();
	});

	/**
	 * `admin` holds organization:read and not organization:manage, so it reaches this
	 * screen and can change nothing on it. Offering it buttons would be offering 403s.
	 */
	it('shows the roles read-only to somebody who cannot manage the organization', async () => {
		grant('organization:read', 'employee:read', 'employee:manage');

		render(RolesPage);
		await untilLoaded();

		expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
		expect(screen.getByText(/changing them needs permission/)).toBeInTheDocument();
		// The roles themselves are still there — reading them is the point of the trip.
		expect(within(card('Payroll')).getByText('See reports')).toBeInTheDocument();
	});

	it('offers no edit for a role holding authority the caller lacks', async () => {
		grant('organization:read', 'organization:manage');

		render(RolesPage);
		await untilLoaded();

		// `employee` carries attendance:read, which this caller does not hold — and
		// which is not self-service, so the API would refuse the edit outright.
		const employeeCard = card('Employee');
		expect(within(employeeCard).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
		expect(within(employeeCard).getByText(/not yours to change/)).toBeInTheDocument();
	});

	it('sends only the permissions when editing a built-in role, never a name', async () => {
		const updated = vi
			.spyOn(roles, 'updateRole')
			.mockResolvedValue({ ...employee, permissions: ['attendance:read'], customized: true });

		render(RolesPage);
		await untilLoaded();

		await fireEvent.click(within(card('Employee')).getByRole('button', { name: 'Edit' }));
		const form = card('Employee');
		expect(within(form).queryByLabelText('Role name')).not.toBeInTheDocument();

		await fireEvent.click(checkbox(form, 'Clock in and out'));
		await fireEvent.click(checkbox(form, 'Request time off'));
		await fireEvent.click(checkbox(form, 'See documents'));
		await fireEvent.click(within(form).getByRole('button', { name: 'Save role' }));

		await waitFor(() =>
			expect(updated).toHaveBeenCalledWith('r-employee', {
				name: undefined,
				permissions: ['attendance:read']
			})
		);
		expect(within(card('Employee')).getByText('Edited')).toBeInTheDocument();
	});

	it('reports a refused save without dropping the form', async () => {
		vi.spyOn(roles, 'updateRole').mockRejectedValue(new Error('offline'));

		render(RolesPage);
		await untilLoaded();

		await fireEvent.click(within(card('Payroll')).getByRole('button', { name: 'Edit' }));
		await fireEvent.click(within(card('Payroll')).getByRole('button', { name: 'Save role' }));

		expect(await within(card('Payroll')).findByText(/could not reach/i)).toBeInTheDocument();
		expect(within(card('Payroll')).getByLabelText('Role name')).toBeInTheDocument();
	});
});
