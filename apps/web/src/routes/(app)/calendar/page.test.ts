import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type {
	AbsenceCalendar,
	AbsenceRequestSummary,
	AbsenceTypeSummary,
	CalendarDay,
	LeaveBalanceSummary
} from '@beacon/shared';
import { datesBetween, isWeekend } from '@beacon/shared';
import '$lib/i18n';
import CalendarPage from './+page.svelte';
import * as absences from '$lib/api/absences';
import { session } from '$lib/auth/session.svelte';
import { gridRange } from '$lib/absence/labels';

/**
 * The page opens on the current month, so the fixture is built around it rather than
 * around a fixed date — pinning August 2026 would make the suite pass only in August.
 */
const MONTH = new Date().toISOString().slice(0, 7);
const RANGE = gridRange(MONTH);
const FIRST = `${MONTH}-01`;

const types: AbsenceTypeSummary[] = [
	{
		id: 't1',
		key: 'vacation',
		name: 'Vacation',
		deductsFromQuota: true,
		paid: true,
		countsAsWork: false,
		colorRole: 'accent',
		active: true,
		position: 0
	},
	{
		id: 't2',
		key: 'home-office',
		name: 'Home office',
		deductsFromQuota: false,
		paid: true,
		countsAsWork: true,
		colorRole: 'info',
		active: true,
		position: 2
	}
];

const request: AbsenceRequestSummary = {
	id: 'a1',
	userId: 'u1',
	userName: 'Sam Tester',
	typeId: 't1',
	typeKey: 'vacation',
	typeName: 'Vacation',
	colorRole: 'accent',
	countsAsWork: false,
	startsOn: FIRST,
	endsOn: FIRST,
	halfDayStart: false,
	halfDayEnd: false,
	status: 'pending',
	costDays: 1,
	workingDays: 1,
	approverId: 'u2',
	approverName: 'Marc Bauer',
	decidedAt: null,
	decisionNote: null,
	note: 'Long weekend',
	documentId: null,
	documentTitle: null,
	createdAt: '2026-08-01T09:00:00.000Z'
};

const balance: LeaveBalanceSummary = {
	year: Number(MONTH.slice(0, 4)),
	entitlementDays: 30,
	carryOverDays: 5,
	carryOverExpiresOn: `${MONTH.slice(0, 4)}-03-31`,
	takenDays: 12,
	pendingDays: 1,
	remainingDays: 23
};

function day(date: string): CalendarDay {
	return {
		date,
		weekend: isWeekend(date),
		holiday: date === FIRST ? null : null,
		absences: date === FIRST ? [request] : []
	};
}

/** Where a date sits in the 42-cell grid. */
function dayIndex(date: string): number {
	return datesBetween(RANGE.from, date).length - 1;
}

/** The first Monday-to-Friday day of the month on show. */
function firstWorkingDay(): string {
	return datesBetween(FIRST, `${MONTH}-28`).find((date) => !isWeekend(date))!;
}

const calendar: AbsenceCalendar = {
	from: RANGE.from,
	to: RANGE.to,
	timezone: 'Europe/Berlin',
	days: datesBetween(RANGE.from, RANGE.to).map(day),
	holidays: []
};

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(session, 'can').mockReturnValue(false);
	vi.spyOn(absences, 'getCalendar').mockResolvedValue(calendar);
	vi.spyOn(absences, 'listAbsenceTypes').mockResolvedValue(types);
	vi.spyOn(absences, 'getLeaveBalance').mockResolvedValue(balance);
	vi.spyOn(absences, 'listAbsences').mockResolvedValue([request]);
});

afterEach(() => vi.restoreAllMocks());

describe('calendar page', () => {
	it('draws six full weeks so the panel below never jumps', async () => {
		render(CalendarPage);

		await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42));
		// Six weeks plus the weekday header. A gridcell has to be owned by a row —
		// a flat run of 42 cells is invalid ARIA and announces no week at all.
		expect(screen.getAllByRole('row')).toHaveLength(7);
	});

	it('reaches every day by keyboard, not only by hover', async () => {
		render(CalendarPage);

		// The canvas selects a range by hovering; a div would leave keyboard users
		// with no way in at all, so every cell is a real button.
		const cells = await screen.findAllByRole('gridcell');
		expect(cells.every((cell) => cell.tagName === 'BUTTON')).toBe(true);
	});

	it('asks for the first day, then the last', async () => {
		render(CalendarPage);

		expect(await screen.findByText('Pick the first day of your absence.')).toBeInTheDocument();

		const cells = await screen.findAllByRole('gridcell');
		const first = cells.find((cell) => cell.textContent?.includes('Vacation'));
		first?.click();

		expect(
			await screen.findByText('Now pick the last day — or the same day again for a single day.')
		).toBeInTheDocument();
	});

	it('prints the cost of a selection before anything is sent', async () => {
		render(CalendarPage);

		const cells = await screen.findAllByRole('gridcell');
		const workday = cells[dayIndex(firstWorkingDay())];

		// Picking the same day twice is how the design asks for a single day off.
		workday.click();
		workday.click();

		// The cost is computed in the browser from the shared arithmetic, so it is on
		// screen before the request card is even submitted.
		expect(await screen.findByText(/· 1 day$/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
	});

	it('shows the quota with its carry-over expiry', async () => {
		render(CalendarPage);

		await waitFor(() => expect(screen.getByText('23 days')).toBeInTheDocument());
		expect(screen.getByText(/Expires/)).toBeInTheDocument();
	});

	it('lists the requests you raised, and who they wait on', async () => {
		render(CalendarPage);

		expect(await screen.findByText('Awaiting Marc Bauer')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
	});

	it('offers no scope switch to someone who cannot approve holiday', async () => {
		render(CalendarPage);

		await screen.findAllByRole('gridcell');
		expect(screen.queryByRole('button', { name: 'My team' })).not.toBeInTheDocument();
	});

	it('offers the whole organization to an approver', async () => {
		vi.spyOn(session, 'can').mockImplementation((permission) => permission === 'holiday:approve');

		render(CalendarPage);

		expect(await screen.findByRole('button', { name: 'Everyone' })).toBeInTheDocument();
	});
});
