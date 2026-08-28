import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { CreatedInvitation, UserSummary } from '@beacon/shared';
import '$lib/i18n';
import PeoplePage from './+page.svelte';
import * as people from '$lib/api/people';
import { session } from '$lib/auth/session.svelte';

const roster: UserSummary[] = [
	{
		id: 'u1',
		employeeNumber: 'BCN-0001',
		email: 'ada@acme.test',
		firstName: 'Ada',
		lastName: 'Lovelace',
		jobTitle: 'Founder',
		status: 'active',
		departmentId: 'd1',
		departmentName: 'Engineering',
		teamId: null,
		teamName: null
	},
	{
		id: 'u2',
		employeeNumber: 'BCN-0002',
		email: 'alan@acme.test',
		firstName: 'Alan',
		lastName: 'Turing',
		jobTitle: null,
		status: 'invited',
		departmentId: null,
		departmentName: null,
		teamId: null,
		teamName: null
	}
];

const invitation: CreatedInvitation = {
	id: 'i1',
	email: 'grace@acme.test',
	firstName: 'Grace',
	lastName: 'Hopper',
	roles: [],
	invitedByName: 'Ada Lovelace',
	expiresAt: '2026-09-11T00:00:00.000Z',
	acceptedAt: null,
	isExpired: false,
	token: 'secret-token',
	acceptUrl: 'http://localhost:5173/invite/secret-token',
	emailSent: true
};

function grant(...permissions: string[]) {
	vi.spyOn(session, 'can').mockImplementation((p) => permissions.includes(p));
}

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(people, 'listPeople').mockResolvedValue(roster);
	vi.spyOn(people, 'listDepartments').mockResolvedValue([
		{ id: 'd1', name: 'Engineering', memberCount: 1 }
	]);
	vi.spyOn(people, 'listInvitations').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('people page', () => {
	it('lists everyone with their status and number', async () => {
		grant('employee:read');
		render(PeoplePage);

		expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
		expect(screen.getByText('Alan Turing')).toBeInTheDocument();
		expect(screen.getByText('Invited')).toBeInTheDocument();
		expect(screen.getByText('BCN-0001')).toBeInTheDocument();
	});

	it('links each row to that person', async () => {
		grant('employee:read');
		render(PeoplePage);

		const link = (await screen.findByText('Ada Lovelace')).closest('a');
		expect(link).toHaveAttribute('href', '/people/u1');
	});

	it('asks the API to filter rather than filtering in the browser', async () => {
		grant('employee:read');
		render(PeoplePage);
		await screen.findByText('Ada Lovelace');

		await fireEvent.input(screen.getByLabelText('Search by name or email'), {
			target: { value: 'turing' }
		});

		await waitFor(() =>
			expect(people.listPeople).toHaveBeenCalledWith({ search: 'turing', departmentId: '' })
		);
	});

	it('hides the invite control from an account that cannot manage people', async () => {
		grant('employee:read');
		render(PeoplePage);
		await screen.findByText('Ada Lovelace');

		expect(screen.queryByRole('button', { name: 'Invite someone' })).not.toBeInTheDocument();
	});

	it('creates an invitation and shows the link exactly once', async () => {
		grant('employee:read', 'employee:manage');
		const create = vi.spyOn(people, 'createInvitation').mockResolvedValue(invitation);
		render(PeoplePage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
		await fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Grace' } });
		await fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Hopper' } });
		await fireEvent.input(screen.getByLabelText('Email address'), {
			target: { value: 'grace@acme.test' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

		await waitFor(() =>
			expect(create).toHaveBeenCalledWith(
				expect.objectContaining({ email: 'grace@acme.test', firstName: 'Grace' })
			)
		);
		expect(await screen.findByText('Invitation sent to grace@acme.test.')).toBeInTheDocument();
		// The link stays on screen either way: the token is never retrievable again.
		expect(await screen.findByText(invitation.acceptUrl)).toBeInTheDocument();
	});

	it('says so when the invitation could not be emailed', async () => {
		grant('employee:read', 'employee:manage');
		vi.spyOn(people, 'createInvitation').mockResolvedValue({ ...invitation, emailSent: false });
		render(PeoplePage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
		await fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Grace' } });
		await fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Hopper' } });
		await fireEvent.input(screen.getByLabelText('Email address'), {
			target: { value: 'grace@acme.test' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

		expect(await screen.findByText(/could not be sent/)).toBeInTheDocument();
		expect(await screen.findByText(invitation.acceptUrl)).toBeInTheDocument();
	});

	it('refuses to send an invitation with an unusable address', async () => {
		grant('employee:read', 'employee:manage');
		const create = vi.spyOn(people, 'createInvitation');
		render(PeoplePage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
		await fireEvent.input(screen.getByLabelText('Email address'), { target: { value: 'nope' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

		expect(create).not.toHaveBeenCalled();
		expect(await screen.findByText('Check the highlighted fields.')).toBeInTheDocument();
	});
});
