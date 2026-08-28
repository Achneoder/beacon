import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { UserDetail } from '@beacon/shared';
import '$lib/i18n';
import ProfilePage from './+page.svelte';
import * as people from '$lib/api/people';
import { session } from '$lib/auth/session.svelte';

const profile: UserDetail = {
	id: 'u1',
	employeeNumber: 'BCN-0148',
	email: 'lena@acme.test',
	firstName: 'Lena',
	lastName: 'Hartmann',
	jobTitle: 'Product Designer',
	status: 'active',
	departmentId: 'd1',
	departmentName: 'Design',
	teamId: 't1',
	teamName: 'Platform',
	locale: 'en',
	timezone: 'Europe/Berlin',
	phone: '+49 30 123456',
	contractType: 'permanent-part-time',
	office: 'Berlin',
	workLocation: 'hybrid',
	startsOn: '2024-03-04',
	endsOn: null,
	managerId: 'u2',
	managerName: 'Marc Bauer',
	managerJobTitle: 'Head of Design',
	roles: [{ id: 'r1', key: 'employee', name: 'employee' }],
	lastLoginAt: null
};

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(people, 'getOwnProfile').mockResolvedValue(profile);
});
afterEach(() => vi.restoreAllMocks());

describe('profile page', () => {
	it('draws the identity header and the employment grid', async () => {
		render(ProfilePage);

		expect(await screen.findByText('Lena Hartmann')).toBeInTheDocument();
		expect(screen.getByText('Product Designer')).toBeInTheDocument();
		// The employee number is mono and appears both as a chip and in the grid.
		expect(screen.getAllByText('BCN-0148').length).toBeGreaterThan(0);
		expect(screen.getByText('Design')).toBeInTheDocument();
		expect(screen.getByText('March 4, 2024')).toBeInTheDocument();
	});

	it('localises the enum fields rather than printing the stored value', async () => {
		render(ProfilePage);

		expect(await screen.findByText('Permanent · Part-time')).toBeInTheDocument();
		expect(screen.getByText('Berlin · Hybrid')).toBeInTheDocument();
	});

	it('names the approver, because every request routes to them', async () => {
		render(ProfilePage);

		expect(await screen.findByText('Marc Bauer')).toBeInTheDocument();
		expect(screen.getByText('Head of Design')).toBeInTheDocument();
	});

	it('shows the roles as display-only chips', async () => {
		render(ProfilePage);

		expect(await screen.findByText('Employee')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /role/i })).not.toBeInTheDocument();
	});

	it('offers only phone and time zone for self-service editing', async () => {
		const update = vi
			.spyOn(people, 'updateOwnProfile')
			.mockResolvedValue({ ...profile, phone: '+49 30 999', timezone: 'Europe/Vienna' });
		const patch = vi.spyOn(session, 'patch').mockImplementation(() => {});
		render(ProfilePage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Edit your details' }));

		expect(screen.getByLabelText('Phone')).toBeInTheDocument();
		expect(screen.getByLabelText('Time zone')).toBeInTheDocument();
		// Employment data is maintained by the organization, never edited here.
		expect(screen.queryByLabelText('Job title')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();

		await fireEvent.input(screen.getByLabelText('Phone'), { target: { value: '+49 30 999' } });
		await fireEvent.input(screen.getByLabelText('Time zone'), {
			target: { value: 'Europe/Vienna' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() =>
			expect(update).toHaveBeenCalledWith({ phone: '+49 30 999', timezone: 'Europe/Vienna' })
		);
		// The page header reads the zone off the session, so it has to be told.
		expect(patch).toHaveBeenCalledWith({ timezone: 'Europe/Vienna' });
	});

	it('says so plainly when a field has not been filled in', async () => {
		vi.spyOn(people, 'getOwnProfile').mockResolvedValue({
			...profile,
			phone: null,
			startsOn: null,
			contractType: null
		});
		render(ProfilePage);

		expect((await screen.findAllByText('Not set')).length).toBeGreaterThanOrEqual(3);
	});
});
