import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type {
	AbsenceCalendar,
	AbsenceRequestSummary,
	AbsenceSummary,
	AttendanceSummary,
	CorrectionSummary
} from '@beacon/shared';
import '$lib/i18n';
import ReportsPage from './+page.svelte';
import * as reports from '$lib/api/reports';
import * as attendance from '$lib/api/attendance';
import * as absences from '$lib/api/absences';
import { ApiError } from '$lib/api/client';
import { session } from '$lib/auth/session.svelte';

const attendanceSummary: AttendanceSummary = {
	range: { from: '2026-08-01', to: '2026-08-29', timezone: 'Europe/Berlin' },
	groupBy: 'user',
	rows: [
		{
			subjectId: 'u1',
			subjectName: 'Ada Lovelace',
			headcount: 1,
			workedMinutes: 9000,
			breakMinutes: 300,
			expectedMinutes: 9600,
			creditedMinutes: 480,
			balanceMinutes: -120,
			daysWorked: 19,
			daysAbsent: 1,
			overtime: { balanceMinutes: 2500, capMinutes: 2400, overCap: true, overCapMinutes: 100 }
		},
		{
			subjectId: 'u2',
			subjectName: 'Otto Tester',
			headcount: 1,
			workedMinutes: 0,
			breakMinutes: 0,
			expectedMinutes: 9600,
			creditedMinutes: 0,
			balanceMinutes: -9600,
			daysWorked: 0,
			daysAbsent: 0,
			overtime: null
		}
	],
	total: {
		subjectId: null,
		subjectName: '',
		headcount: 2,
		workedMinutes: 9000,
		breakMinutes: 300,
		expectedMinutes: 19200,
		creditedMinutes: 480,
		balanceMinutes: -9720,
		daysWorked: 19,
		daysAbsent: 1,
		overtime: null
	},
	overtimeMinutes: 2500,
	overCapCount: 1,
	headcount: 2
};

const absenceSummary: AbsenceSummary = {
	year: 2026,
	rows: [
		{
			userId: 'u1',
			userName: 'Ada Lovelace',
			departmentName: 'Engineering',
			year: 2026,
			entitlementDays: 30,
			carryOverDays: 2,
			carryOverExpiresOn: null,
			takenDays: 12,
			pendingDays: 3,
			remainingDays: 20
		}
	],
	total: {
		entitlementDays: 30,
		carryOverDays: 2,
		takenDays: 12,
		pendingDays: 3,
		remainingDays: 20
	}
};

const correction: CorrectionSummary = {
	id: 'c1',
	kind: 'add',
	entryId: null,
	requestedById: 'u2',
	requestedByName: 'Otto Tester',
	approverId: 'u1',
	approverName: 'Ada Lovelace',
	date: '2026-08-10',
	startedAt: '2026-08-10T07:00:00.000Z',
	endedAt: '2026-08-10T15:00:00.000Z',
	breakMinutes: 30,
	reason: 'Forgot to clock in.',
	status: 'pending',
	decidedAt: null,
	decisionNote: null,
	createdAt: '2026-08-11T08:00:00.000Z'
};

const pendingAbsence = {
	id: 'a1',
	userId: 'u2',
	userName: 'Otto Tester',
	status: 'pending',
	startsOn: '2026-09-07',
	endsOn: '2026-09-11'
} as unknown as AbsenceRequestSummary;

const outAbsence = {
	id: 'a2',
	userId: 'u3',
	userName: 'Grace Hopper',
	status: 'approved',
	startsOn: '2026-08-24',
	endsOn: '2026-08-28'
} as unknown as AbsenceRequestSummary;

const calendar = {
	from: '2026-08-24',
	to: '2026-08-30',
	timezone: 'Europe/Berlin',
	holidays: [],
	// The same person on two days is one person who is out.
	days: [
		{ date: '2026-08-24', weekend: false, holiday: null, absences: [outAbsence] },
		{ date: '2026-08-25', weekend: false, holiday: null, absences: [outAbsence] }
	]
} as unknown as AbsenceCalendar;

function grant(...permissions: string[]) {
	vi.spyOn(session, 'can').mockImplementation((p) => permissions.includes(p));
}

/**
 * Both tables list the same people, so every row query is scoped to the table it
 * belongs to. An unscoped `getByRole('rowheader')` matches the attendance row and
 * the holiday row alike, and would pass for the wrong reason as readily as it fails.
 */
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const attendanceTable = () => within(byId('reports-attendance-table'));
const absenceTable = () => within(byId('reports-absence-table'));

/** The tile whose label is `label`, as a query root. */
const tile = (label: string) =>
	screen.getByText(label).closest('[class*="rounded-card"]') as HTMLElement;

const untilLoaded = () =>
	waitFor(() => expect(byId('reports-attendance-table')).toBeInTheDocument());

const MANAGER = ['report:read', 'attendance:read', 'attendance:approve', 'holiday:approve'];

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(reports, 'getAttendanceSummary').mockResolvedValue(attendanceSummary);
	vi.spyOn(reports, 'getAbsenceSummary').mockResolvedValue(absenceSummary);
	vi.spyOn(reports, 'downloadAttendanceCsv').mockResolvedValue(undefined);
	vi.spyOn(attendance, 'listCorrections').mockResolvedValue([correction]);
	vi.spyOn(absences, 'listAbsences').mockResolvedValue([pendingAbsence]);
	vi.spyOn(absences, 'getCalendar').mockResolvedValue(calendar);
});
afterEach(() => vi.restoreAllMocks());

describe('reports page', () => {
	it('shows the attendance rows with worked, expected and balance', async () => {
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();

		const row = within(
			attendanceTable()
				.getByRole('rowheader', { name: /Ada Lovelace/ })
				.closest('tr')!
		);
		// Worked, credited, expected, balance, then the lifetime bank over its cap.
		expect(row.getByRole('cell', { name: '150:00' })).toBeInTheDocument();
		expect(row.getByRole('cell', { name: '8:00' })).toBeInTheDocument();
		expect(row.getByRole('cell', { name: '160:00' })).toBeInTheDocument();
		expect(row.getByRole('cell', { name: '-2:00' })).toBeInTheDocument();
		expect(row.getByText('Over cap')).toBeInTheDocument();
	});

	it('shows a person who worked nothing rather than dropping them', async () => {
		// The bug the AttendanceDay ledger would have shipped, as the reader sees it.
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();

		const table = attendanceTable();
		expect(table.getByRole('rowheader', { name: /Otto Tester/ })).toBeInTheDocument();
		expect(table.getByRole('cell', { name: '-160:00' })).toBeInTheDocument();
	});

	it('totals the columns so the reader never adds them up', async () => {
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();

		const total = attendanceTable()
			.getByRole('rowheader', { name: 'Total' })
			.closest('tr') as HTMLElement;
		expect(total).toHaveTextContent('320:00');
		expect(total).toHaveTextContent('-162:00');
	});

	it('counts both approval queues into one tile, and links to them', async () => {
		grant(...MANAGER);
		render(ReportsPage);

		await waitFor(() => expect(tile('Awaiting you')).toHaveTextContent('2'));
		// One pending correction plus one pending absence.
		expect(
			within(tile('Awaiting you')).getByRole('link', { name: 'Open approvals' })
		).toHaveAttribute('href', '/approvals');
	});

	it('counts a person out on two days of the week once', async () => {
		grant(...MANAGER);
		render(ReportsPage);

		await waitFor(() => expect(tile('Out this week')).toHaveTextContent('Grace Hopper'));
		expect(within(tile('Out this week')).getByText('1')).toBeInTheDocument();
	});

	it('calls out how many people stand over their overtime cap', async () => {
		grant(...MANAGER);
		render(ReportsPage);

		await waitFor(() => expect(tile('Overtime bank')).toHaveTextContent('1 over their cap'));
		expect(tile('Overtime bank')).toHaveTextContent('+41:40');
		expect(tile('Overtime bank')).toHaveTextContent('2 people');
	});

	it('re-queries when the grouping changes, and renames the first column', async () => {
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();

		await fireEvent.click(screen.getByRole('button', { name: 'Department' }));

		await waitFor(() =>
			expect(reports.getAttendanceSummary).toHaveBeenCalledWith(
				expect.objectContaining({ groupBy: 'department' })
			)
		);
		expect(attendanceTable().getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
	});

	it('re-queries the range without touching the absence year', async () => {
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();
		const absenceCalls = vi.mocked(reports.getAbsenceSummary).mock.calls.length;

		await fireEvent.click(screen.getByRole('button', { name: 'Last month' }));

		await waitFor(() =>
			expect(reports.getAttendanceSummary).toHaveBeenCalledWith(
				expect.objectContaining({ to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
			)
		);
		// The bands are independent: changing one must not refetch the other.
		expect(vi.mocked(reports.getAbsenceSummary).mock.calls).toHaveLength(absenceCalls);
	});

	it('exports the range currently on screen', async () => {
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();

		await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

		await waitFor(() =>
			expect(reports.downloadAttendanceCsv).toHaveBeenCalledWith(
				expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-01$/) }),
				expect.stringContaining('.csv')
			)
		);
	});

	it('surfaces a failing band without blanking the other', async () => {
		// The Today screen already learned this: one Promise.all meant a failing
		// absence call blanked the attendance figures beside it.
		grant(...MANAGER);
		vi.mocked(reports.getAbsenceSummary).mockRejectedValue(new ApiError(500, 'boom'));
		render(ReportsPage);
		await untilLoaded();

		expect(attendanceTable().getByRole('rowheader', { name: /Ada Lovelace/ })).toBeInTheDocument();
		expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
	});

	it('asks for no queue a caller cannot approve, and still loads the reports', async () => {
		grant('report:read', 'attendance:read');
		render(ReportsPage);
		await untilLoaded();

		expect(attendance.listCorrections).not.toHaveBeenCalled();
		expect(absences.listAbsences).not.toHaveBeenCalled();
		// Their own reports' calendar, not the organization's.
		expect(absences.getCalendar).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(String),
			'team'
		);
	});

	it('shows the holiday quota per person, with its department', async () => {
		grant(...MANAGER);
		render(ReportsPage);
		await untilLoaded();

		const header = absenceTable().getByRole('rowheader', { name: /Ada Lovelace/ });
		expect(header).toHaveTextContent('Engineering');

		const row = within(header.closest('tr') as HTMLElement);
		// Entitlement plus carry-over as one figure — the quota someone actually has —
		// then taken, pending and remaining.
		expect(row.getByRole('cell', { name: '32 d' })).toBeInTheDocument();
		expect(row.getByRole('cell', { name: '12 d' })).toBeInTheDocument();
		expect(row.getByRole('cell', { name: '3 d' })).toBeInTheDocument();
		expect(row.getByRole('cell', { name: '20 d' })).toBeInTheDocument();
	});

	it('names the chart tables so the plots point at them instead of duplicating', async () => {
		grant(...MANAGER);
		const { container } = render(ReportsPage);
		await untilLoaded();

		expect(
			container.querySelector('figure[aria-describedby="reports-attendance-table"]')
		).toBeInTheDocument();
		expect(
			container.querySelector('figure[aria-describedby="reports-absence-table"]')
		).toBeInTheDocument();
	});
});
