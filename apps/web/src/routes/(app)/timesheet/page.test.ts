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
		entries: [],
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
			entries: [
				{
					id: 'entry-monday',
					startedAt: '2026-08-24T07:00:00.000Z',
					endedAt: '2026-08-24T14:35:00.000Z',
					breakMinutes: 30,
					source: 'web',
					note: null,
					approvalStatus: 'approved'
				}
			]
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

	it('lists a day’s records and offers to add one when it opens', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });

		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Correct a day' });
		await fireEvent.click(open);

		// Monday's one tracked record is listed, with its own edit/delete actions.
		expect(await screen.findByText('Records for this day')).toBeInTheDocument();
		const record = screen.getByRole('listitem');
		expect(record).toHaveTextContent('09:00 – 16:35');
		expect(record).toHaveTextContent('Break 0:30');
		expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

		// The form itself opens blank, ready to add a new record rather than assuming
		// the existing one is being changed.
		expect(screen.getByLabelText('Start')).toHaveValue('09:00');
		expect(screen.getByLabelText('End')).toHaveValue('17:00');
		expect(screen.getByLabelText('Break (minutes)')).toHaveValue(30);
	});

	it('says a day with nothing tracked yet has no records', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });

		render(TimesheetPage);

		// Friday has nothing tracked — clicking its row in the table opens the panel
		// on that day directly, with no date picker involved.
		await fireEvent.click(await screen.findByRole('button', { name: /Friday/ }));

		expect(await screen.findByText('Nothing tracked for this day yet.')).toBeInTheDocument();
	});

	it('opens the panel on the day clicked in the table, not a fixed default', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });

		render(TimesheetPage);

		await fireEvent.click(await screen.findByRole('button', { name: /Friday/ }));

		expect(await screen.findByText('Records for this day')).toBeInTheDocument();
		expect(screen.getByText('Nothing tracked for this day yet.')).toBeInTheDocument();

		// Clicking a different day while the panel is open switches it, rather than
		// requiring it to be closed and reopened.
		await fireEvent.click(screen.getByRole('button', { name: /Monday/ }));

		expect(await screen.findByRole('listitem')).toHaveTextContent('09:00 – 16:35');
	});

	it('adds a new record alongside an existing one rather than overwriting it', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });
		const request = vi
			.spyOn(attendance, 'requestCorrection')
			.mockResolvedValue({} as CorrectionSummary);

		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Correct a day' });
		await fireEvent.click(open);

		await fireEvent.input(screen.getByLabelText('Start'), { target: { value: '18:00' } });
		await fireEvent.input(screen.getByLabelText('End'), { target: { value: '19:00' } });
		await fireEvent.input(screen.getByLabelText('Reason'), {
			target: { value: 'a short evening stint I forgot to clock' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));

		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'add', entryId: null }))
		);
	});

	it('amends an existing record once it is picked for editing', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });
		const request = vi
			.spyOn(attendance, 'requestCorrection')
			.mockResolvedValue({} as CorrectionSummary);

		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Correct a day' });
		await fireEvent.click(open);
		await fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

		// The form now loads what is on the books (09:00–16:35 Berlin, 30 minutes'
		// break) instead of the blank-record defaults.
		expect(screen.getByLabelText('Start')).toHaveValue('09:00');
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

	it('removes a record once its deletion is confirmed with a reason', async () => {
		vi.spyOn(attendance, 'getWeek').mockResolvedValue({ ...week, selfApproveCorrections: true });
		const request = vi
			.spyOn(attendance, 'requestCorrection')
			.mockResolvedValue({} as CorrectionSummary);

		render(TimesheetPage);

		const open = await screen.findByRole('button', { name: 'Correct a day' });
		await fireEvent.click(open);
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		// Removing needs no times — just the warning and why.
		expect(screen.queryByLabelText('Start')).not.toBeInTheDocument();
		expect(
			screen.getByText('This removes the record entirely. It cannot be undone.')
		).toBeInTheDocument();

		await fireEvent.input(screen.getByLabelText('Reason'), {
			target: { value: 'duplicate of the corrected entry' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));

		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(
				expect.objectContaining({ kind: 'remove', entryId: 'entry-monday' })
			)
		);
		expect(request).toHaveBeenCalledWith(
			expect.not.objectContaining({ startedAt: expect.anything() })
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
