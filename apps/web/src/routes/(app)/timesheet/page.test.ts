import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { CorrectionSummary, TimesheetDay, TimesheetWeek } from '@beacon/shared';
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
		holiday: null,
		hasPendingCorrection: false,
		entryId: null,
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
			balanceMinutes: 65,
				entryId: 'entry-monday'
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
	locksAt: '2026-08-31T07:00:00.000Z',
	selfApproveCorrections: false
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

	it('shows a public holiday with no target, and hours worked on it as overtime', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({
			...week,
			days: week.days.map((entry) =>
				entry.date === '2026-08-28'
					? {
							...entry,
							workedMinutes: 90,
							targetMinutes: 0,
							balanceMinutes: 90,
							holiday: 'Founders Day'
						}
					: entry
			)
		});

		render(TimesheetPage);

		expect(await screen.findByText('Founders Day')).toBeInTheDocument();
		expect(screen.getByText('+1:30')).toBeInTheDocument();
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

	it('says a manager decides the correction it is asking for', async () => {
		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Request correction' });
		open.click();

		expect(
			await screen.findByText('Your manager decides. Say what the day should have been and why.')
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
	});

	it('offers to correct a day outright where the organization allows it', async () => {
		// The API decides what a correction does; the week says so, and only the copy
		// changes — the form and the request it sends are the same either way.
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });

		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Correct a day' });
		open.click();

		expect(
			await screen.findByText(
				'Your change applies straight away. Say what the day should have been and why.'
			)
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Apply correction' })).toBeInTheDocument();
	});

	it('amends the day’s existing entry instead of adding a duplicate one', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });
		const request = vi
			.spyOn(attendance, 'requestCorrection')
			.mockResolvedValue({} as CorrectionSummary);

		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Correct a day' });
		await fireEvent.click(open);

		// Monday already carries one entry — the form loads what is on the books
		// (09:00–16:35 Berlin, 30 minutes' break) instead of the blank-day defaults.
		expect(await screen.findByLabelText('Start')).toHaveValue('09:00');
		expect(screen.getByLabelText('End')).toHaveValue('16:35');
		expect(screen.getByLabelText('Break (minutes)')).toHaveValue(30);

		await fireEvent.input(screen.getByLabelText('Reason'), {
			target: { value: 'left too early on the original clock-out' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));

		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(
				expect.objectContaining({ kind: 'amend', entryId: 'entry-monday' })
			)
		);
	});

	it('says a closed week can still be put right by the person it belongs to', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({
			...week,
			locked: true,
			offset: -3,
			selfApproveCorrections: true
		});

		render(TimesheetPage);

		expect(
			await screen.findByText(
				'This week is closed, but your own corrections still apply straight away.'
			)
		).toBeInTheDocument();
	});

	it('pages back a week and refuses to page past the current one', async () => {
		render(TimesheetPage);

		const next = await screen.findByRole('button', { name: 'Next week' });
		expect(next).toBeDisabled();

		await screen.getByRole('button', { name: 'Previous week' }).click();
		await waitFor(() => expect(attendance.getWeek).toHaveBeenCalledWith(-1));
	});
});
