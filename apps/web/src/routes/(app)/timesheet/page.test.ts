import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { TimesheetDay, TimesheetWeek } from '@beacon/shared';
import '$lib/i18n';
import TimesheetPage from './+page.svelte';
import * as attendance from '$lib/api/attendance';

function day(overrides: Partial<TimesheetDay> & Pick<TimesheetDay, 'date' | 'weekday'>) {
	return {
		startedAt: null,
		endedAt: null,
		workedMinutes: 0,
		breakMinutes: 0,
		targetMinutes: 360,
		balanceMinutes: -360,
		absenceTag: null,
		credited: false,
		hasPendingCorrection: false,
		...overrides
	} satisfies TimesheetDay;
}

const week: TimesheetWeek = {
	from: '2026-08-24',
	to: '2026-08-30',
	offset: 0,
	timezone: 'Europe/Berlin',
	days: [
		day({
			date: '2026-08-24',
			weekday: 'monday',
			startedAt: '2026-08-24T07:00:00.000Z',
			endedAt: '2026-08-24T14:35:00.000Z',
			workedMinutes: 425,
			breakMinutes: 30,
			balanceMinutes: 65
		}),
		day({
			date: '2026-08-25',
			weekday: 'tuesday',
			workedMinutes: 0,
			balanceMinutes: 0,
			absenceTag: 'Vacation',
			credited: true
		}),
		day({
			date: '2026-08-26',
			weekday: 'wednesday',
			startedAt: '2026-08-26T07:30:00.000Z',
			endedAt: '2026-08-26T13:35:00.000Z',
			workedMinutes: 335,
			breakMinutes: 30,
			balanceMinutes: -25,
			absenceTag: 'Home office'
		}),
		day({ date: '2026-08-27', weekday: 'thursday', hasPendingCorrection: true }),
		day({ date: '2026-08-28', weekday: 'friday' }),
		day({ date: '2026-08-29', weekday: 'saturday', targetMinutes: 0, balanceMinutes: 0 }),
		day({ date: '2026-08-30', weekday: 'sunday', targetMinutes: 0, balanceMinutes: 0 })
	],
	workedMinutes: 760,
	breakMinutes: 60,
	targetMinutes: 1800,
	balanceMinutes: 40,
	overtime: { balanceMinutes: 860, capMinutes: 2400, overCap: false, overCapMinutes: 0 },
	locked: false,
	locksAt: '2026-08-31T07:00:00.000Z'
};

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(attendance, 'getWeek').mockResolvedValue(week);
});
afterEach(() => vi.restoreAllMocks());

describe('timesheet page', () => {
	it('draws the seven rows of the week with their totals', async () => {
		render(TimesheetPage);

		expect(await screen.findByRole('rowheader', { name: /Monday/ })).toBeInTheDocument();
		expect(screen.getByRole('rowheader', { name: /Sunday/ })).toBeInTheDocument();
		// The total row carries the week's worked time and its balance.
		expect(screen.getByText('12:40')).toBeInTheDocument();
		expect(screen.getByText('+0:40')).toBeInTheDocument();
	});

	it('converts the stored instants into the user’s own zone', async () => {
		render(TimesheetPage);

		// 07:00 UTC is 09:00 in Berlin.
		expect(await screen.findByText('09:00')).toBeInTheDocument();
		expect(screen.getByText('16:35')).toBeInTheDocument();
	});

	it('prints an absence day as credited rather than as a day of undertime', async () => {
		render(TimesheetPage);

		expect(await screen.findByText('credited')).toBeInTheDocument();
		expect(screen.getByText('Vacation')).toBeInTheDocument();
	});

	it('lets a working day carry both an absence tag and real hours', async () => {
		render(TimesheetPage);

		expect(await screen.findByText('Home office')).toBeInTheDocument();
		// Wednesday is tagged and still balances on the hours actually worked.
		expect(screen.getByText('5:35')).toBeInTheDocument();
		expect(screen.getByText('-0:25')).toBeInTheDocument();
	});

	it('names the moment the week stops being editable', async () => {
		render(TimesheetPage);

		expect(await screen.findByText('Week is unlocked until Monday 09:00.')).toBeInTheDocument();
	});

	it('says a closed week needs a correction instead of an edit', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, locked: true, offset: -3 });

		render(TimesheetPage);

		expect(
			await screen.findByText('This week is closed. Ask for a correction to change it.')
		).toBeInTheDocument();
	});

	it('marks a day that already has a correction waiting', async () => {
		render(TimesheetPage);

		expect(await screen.findByText('Correction pending')).toBeInTheDocument();
	});

	it('pages back a week and refuses to page past the current one', async () => {
		render(TimesheetPage);

		const next = await screen.findByRole('button', { name: 'Next week' });
		expect(next).toBeDisabled();

		await screen.getByRole('button', { name: 'Previous week' }).click();
		await waitFor(() => expect(attendance.getWeek).toHaveBeenCalledWith(-1));
	});
});
