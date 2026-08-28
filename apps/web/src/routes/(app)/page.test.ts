import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { TimesheetWeek, TodayStatus } from '@beacon/shared';
import '$lib/i18n';
import TodayPage from './+page.svelte';
import * as attendance from '$lib/api/attendance';
import { clock } from '$lib/attendance/clock.svelte';
import { session } from '$lib/auth/session.svelte';

const today: TodayStatus = {
	timezone: 'Europe/Berlin',
	date: '2026-08-28',
	state: 'in',
	since: '2026-08-28T07:00:00.000Z',
	segments: [
		{
			id: 's1',
			kind: 'work',
			startedAt: '2026-08-28T07:00:00.000Z',
			endedAt: null,
			source: 'badge',
			note: 'Office',
			approvalStatus: 'approved',
			durationMinutes: null
		},
		{
			id: 's2',
			kind: 'break',
			startedAt: '2026-08-28T10:00:00.000Z',
			endedAt: '2026-08-28T10:30:00.000Z',
			source: 'web',
			note: null,
			approvalStatus: 'approved',
			durationMinutes: 30
		}
	],
	workedMinutes: 227,
	breakMinutes: 30,
	targetMinutes: 360
};

const week: TimesheetWeek = {
	from: '2026-08-24',
	to: '2026-08-30',
	offset: 0,
	timezone: 'Europe/Berlin',
	days: [],
	workedMinutes: 1360,
	breakMinutes: 120,
	targetMinutes: 1800,
	balanceMinutes: 105,
	overtime: { balanceMinutes: 860, capMinutes: 2400, overCap: false, overCapMinutes: 0 },
	locked: false,
	locksAt: '2026-08-31T07:00:00.000Z'
};

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(session, 'can').mockReturnValue(true);
	vi.spyOn(attendance, 'getToday').mockResolvedValue(today);
	vi.spyOn(attendance, 'getWeek').mockResolvedValue(week);
	await clock.refresh();
});

afterEach(() => {
	clock.reset();
	vi.restoreAllMocks();
});

describe('today page', () => {
	it('names the clock state and the day against its target', async () => {
		render(TodayPage);

		expect(await screen.findByText('Clocked in')).toBeInTheDocument();
		// 227 minutes of a 360-minute day, both as H:MM.
		expect(screen.getAllByText('3:47 of 6:00').length).toBeGreaterThan(0);
	});

	it('offers the two actions that belong to the running state', async () => {
		render(TodayPage);

		expect(await screen.findByRole('button', { name: 'Clock out' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Start break' })).toBeInTheDocument();
		// Clocking in again is not on offer while the clock runs.
		expect(screen.queryByRole('button', { name: 'Clock in' })).not.toBeInTheDocument();
	});

	it('prints the day progress as an accessible bar, not just a colour', async () => {
		render(TodayPage);

		const bar = await screen.findByRole('progressbar', {
			name: "Progress towards today's target"
		});
		expect(bar).toHaveAttribute('aria-valuetext', '3:47 of 6:00');
	});

	it('renders segments in the user’s zone with their source', async () => {
		render(TodayPage);

		// 07:00 UTC is 09:00 in Berlin, and the running segment has no end yet.
		expect(await screen.findByText('09:00 – running')).toBeInTheDocument();
		expect(screen.getByText('12:00 – 12:30')).toBeInTheDocument();
		expect(screen.getByText('Badge')).toBeInTheDocument();
		expect(screen.getByText('Office')).toBeInTheDocument();
	});

	it('shows the week balance and the overtime bank against its cap', async () => {
		render(TodayPage);

		await waitFor(() => expect(screen.getByText('+1:45')).toBeInTheDocument());
		expect(screen.getByText('+14:20')).toBeInTheDocument();
		expect(screen.getByText('Cap 40:00')).toBeInTheDocument();
	});

	it('flags a balance that has run past its cap without hiding the hours', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({
			...week,
			overtime: { balanceMinutes: 2540, capMinutes: 2400, overCap: true, overCapMinutes: 140 }
		});

		render(TodayPage);

		// The balance keeps climbing past the cap; the hint says by how much.
		await waitFor(() => expect(screen.getByText('+42:20')).toBeInTheDocument());
		expect(screen.getByText('2:20 over the cap — still counted.')).toBeInTheDocument();
	});
});

describe('the shared clock', () => {
	it('drives the sidebar and the page from one server-supplied instant', () => {
		expect(clock.state).toBe('in');
		expect(clock.since).toBe('2026-08-28T07:00:00.000Z');
	});

	it('leaves the last known state on screen when a refresh fails', async () => {
		vi.spyOn(attendance, 'getToday').mockRejectedValue(new Error('offline'));
		await clock.refresh();

		expect(clock.state).toBe('in');
	});

	it('forgets everything on sign-out', () => {
		clock.reset();

		expect(clock.today).toBeNull();
		expect(clock.state).toBe('out');
	});
});
