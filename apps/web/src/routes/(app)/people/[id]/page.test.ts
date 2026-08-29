import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { DepartmentSummary, TeamSummary, UserDetail, UserSummary } from '@beacon/shared';
import '$lib/i18n';
import PersonPage from './+page.svelte';
import * as people from '$lib/api/people';
import { session } from '$lib/auth/session.svelte';

const pageState = vi.hoisted(() => ({ params: { id: 'u1' } }));
vi.mock('$app/state', () => ({ page: pageState }));

const person: UserDetail = {
	id: 'u1',
	employeeNumber: 'BCN-0001',
	email: 'ben@acme.test',
	firstName: 'Ben',
	lastName: 'Engineer',
	jobTitle: 'Software Engineer',
	status: 'active',
	departmentId: null,
	departmentName: null,
	teamId: null,
	teamName: null,
	locale: 'en',
	timezone: null,
	phone: null,
	contractType: null,
	office: null,
	workLocation: null,
	startsOn: null,
	endsOn: null,
	managerId: null,
	managerName: null,
	managerJobTitle: null,
	roles: [{ id: 'r1', key: 'employee', name: 'employee' }],
	lastLoginAt: null
};

const departments: DepartmentSummary[] = [{ id: 'd1', name: 'Engineering', memberCount: 1 }];
const teams: TeamSummary[] = [{ id: 't1', name: 'Platform', departmentId: 'd1', memberCount: 1 }];
const managers: UserSummary[] = [
	{
		id: 'u2',
		employeeNumber: 'BCN-0002',
		email: 'ada@acme.test',
		firstName: 'Ada',
		lastName: 'Owner',
		jobTitle: 'Owner',
		status: 'active',
		departmentId: null,
		departmentName: null,
		teamId: null,
		teamName: null
	}
];

function grant(...permissions: string[]) {
	vi.spyOn(session, 'can').mockImplementation((p) => permissions.includes(p));
}

beforeEach(async () => {
	await waitLocale('en');
	pageState.params = { id: 'u1' };
	vi.spyOn(people, 'getPerson').mockResolvedValue(person);
	vi.spyOn(people, 'listDepartments').mockResolvedValue(departments);
	vi.spyOn(people, 'listTeams').mockResolvedValue(teams);
	vi.spyOn(people, 'listPeople').mockResolvedValue(managers);
});
afterEach(() => vi.restoreAllMocks());

describe('person detail page', () => {
	it('hides the edit-assignment control from someone who cannot manage people', async () => {
		grant('employee:read');
		render(PersonPage);

		// The page title and the person card both print the name, so there are two matches.
		expect((await screen.findAllByText('Ben Engineer')).length).toBeGreaterThan(0);
		expect(screen.queryByRole('button', { name: 'Edit assignment' })).not.toBeInTheDocument();
	});

	it('assigns a department, team and manager', async () => {
		grant('employee:read', 'employee:manage');
		const update = vi.spyOn(people, 'updatePerson').mockResolvedValue({
			...person,
			departmentId: 'd1',
			departmentName: 'Engineering',
			teamId: 't1',
			teamName: 'Platform',
			managerId: 'u2',
			managerName: 'Ada Owner'
		});
		render(PersonPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Edit assignment' }));

		await fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd1' } });
		await fireEvent.change(screen.getByLabelText('Team'), { target: { value: 't1' } });
		await fireEvent.change(screen.getByLabelText('Manager'), { target: { value: 'u2' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() =>
			expect(update).toHaveBeenCalledWith('u1', {
				departmentId: 'd1',
				teamId: 't1',
				managerId: 'u2'
			})
		);
		expect(await screen.findByText('Assignment updated.')).toBeInTheDocument();
	});

	it('clears an assignment back to "not set" rather than leaving it unset in the request', async () => {
		grant('employee:read', 'employee:manage');
		const update = vi.spyOn(people, 'updatePerson').mockResolvedValue(person);
		render(PersonPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Edit assignment' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() =>
			expect(update).toHaveBeenCalledWith('u1', {
				departmentId: null,
				teamId: null,
				managerId: null
			})
		);
	});

	it('excludes the person themselves from the manager options', async () => {
		grant('employee:read', 'employee:manage');
		vi.spyOn(people, 'listPeople').mockResolvedValue([
			...managers,
			{ ...managers[0], id: 'u1', firstName: 'Ben', lastName: 'Engineer' }
		]);
		render(PersonPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Edit assignment' }));

		const managerSelect = screen.getByLabelText('Manager') as HTMLSelectElement;
		const optionNames = Array.from(managerSelect.options).map((option) => option.textContent);
		expect(optionNames).not.toContain('Ben Engineer');
		expect(optionNames).toContain('Ada Owner');
	});
});
