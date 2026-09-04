/**
 * Reporting — the aggregate shapes `report:read` finally has a consumer for.
 *
 * Everything here is derived: every figure is recomputed from attendance entries,
 * schedules, absence requests and leave balances, so nothing in this file describes
 * a stored row. That is deliberate and is why the phase ships no entity and no
 * migration — a report that owned state would be a second authority on hours already
 * settled by the timesheet.
 *
 * The arithmetic itself lives in `attendance.ts` and `absence.ts` and is *reused*
 * rather than restated: a total on a report and a total on a timesheet must not be
 * able to disagree.
 */

import type { OvertimeSummary } from './attendance.js';
import type { LeaveBalanceSummary } from './absence.js';

/** What the attendance summary's rows stand for. */
export const REPORT_GROUP_BY = ['user', 'department'] as const;

export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];

export function isReportGroupBy(value: string): value is ReportGroupBy {
  return (REPORT_GROUP_BY as readonly string[]).includes(value);
}

/** The span a report covers, as local calendar dates in the subject's own zone. */
export interface ReportRange {
  from: string;
  to: string;
  /** The zone the dates were resolved in, so the screen can say which day it means. */
  timezone: string;
}

/**
 * One row of the attendance summary — a person, or a department once they are rolled
 * up.
 *
 * `workedMinutes` and `creditedMinutes` are kept apart on purpose. A day off met its
 * target through the absence, not through work; adding the two together would report
 * hours nobody worked, and reporting only the first would make every holiday look
 * like absenteeism. The screen shows both and sums them only where it says so.
 */
export interface AttendanceSummaryRow {
  /** A user id, a department id, or `null` for the unassigned bucket. */
  subjectId: string | null;
  subjectName: string;
  /** How many people the row stands for — 1 when grouped by user. */
  headcount: number;
  workedMinutes: number;
  breakMinutes: number;
  /** The schedule's target across the range, weekends and holidays already excluded. */
  expectedMinutes: number;
  /** Target met by a credited absence rather than by worked time. */
  creditedMinutes: number;
  /** Worked minus expected, credited days honoured. Signed. */
  balanceMinutes: number;
  /** Days with at least one minute of real work. */
  daysWorked: number;
  /** Days covered by an absence of any kind, credited or not. */
  daysAbsent: number;
  /**
   * The running overtime bank, which is *not* range-scoped — it is the person's
   * lifetime balance. `null` for a department row, where summing lifetime banks
   * across people would be a number with no meaning, and for anyone who has never
   * had one written.
   */
  overtime: OvertimeSummary | null;
}

/** `GET /reports/attendance/summary`. */
export interface AttendanceSummary {
  range: ReportRange;
  groupBy: ReportGroupBy;
  rows: AttendanceSummaryRow[];
  /** The same figures across every row, so the screen never re-adds them itself. */
  total: AttendanceSummaryRow;
  /**
   * The overtime bank summed across everyone the caller may see, and how many of them
   * stand over their cap. Reported beside the rows rather than inside `total` because
   * the bank is a lifetime figure that the range does not scope, and because the
   * dashboard's team-overtime card needs it whichever grouping the table is showing.
   */
  overtimeMinutes: number;
  overCapCount: number;
  /** How many people the figures above cover. */
  headcount: number;
}

/** One person's year of holiday, as the absence report prints it. */
export interface AbsenceSummaryRow extends LeaveBalanceSummary {
  userId: string;
  userName: string;
  /** Their department, for the grouping the screen offers; `null` when unassigned. */
  departmentName: string | null;
}

/** `GET /reports/absences/summary`. */
export interface AbsenceSummary {
  year: number;
  rows: AbsenceSummaryRow[];
  /** Column sums. Not a `LeaveBalanceSummary` — a shared entitlement is not a quota. */
  total: {
    entitlementDays: number;
    carryOverDays: number;
    takenDays: number;
    pendingDays: number;
    remainingDays: number;
  };
}

// ---------------------------------------------------------------- billable

/** What the billable summary's rows stand for. */
export const BILLABLE_GROUP_BY = ['project', 'task', 'client', 'user'] as const;

export type BillableGroupBy = (typeof BILLABLE_GROUP_BY)[number];

export function isBillableGroupBy(value: string): value is BillableGroupBy {
  return (BILLABLE_GROUP_BY as readonly string[]).includes(value);
}

/**
 * One row of the billable summary — a project, task, client tag or user, depending on
 * `BillableSummary.groupBy`.
 *
 * `amount` is the sum of each entry's frozen `TimeEntry.amount` only — never a live
 * estimate off a project's current rate — so it always matches what was actually billed
 * at the time each entry was booked, the same discipline the entry itself keeps.
 */
export interface BillableSummaryRow {
  /** A project/task/user id, the client tag itself, or `null` for the ungrouped bucket. */
  key: string | null;
  label: string;
  /** Includes live minutes from a currently running entry. */
  minutes: number;
  billableMinutes: number;
  amount: number;
  /** Billable minutes with no rate resolved, and so contributing nothing to `amount`. */
  unratedMinutes: number;
  entryCount: number;
}

/** `GET /reports/time/summary`. */
export interface BillableSummary {
  range: ReportRange;
  groupBy: BillableGroupBy;
  rows: BillableSummaryRow[];
  total: BillableSummaryRow;
  /** How many rows include a still-running entry, so the screen can flag them as live. */
  runningCount: number;
}

// ---------------------------------------------------------------- csv

/** RFC 4180 separator. Fixed rather than localized — the header row is machine-read. */
export const CSV_SEPARATOR = ',';

/** A plain number, negatives and decimals included — never a formula. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * One cell, escaped.
 *
 * Two hazards, and the second is the one that bites. RFC 4180 quoting handles
 * separators, quotes and newlines. **Formula injection** handles the rest: a
 * spreadsheet treats a cell opening with `=`, `+`, `-` or `@` as a formula, and the
 * names, notes and reasons that go into an attendance export are user-supplied text.
 * A leading `'` neutralises it while still reading as the original string in every
 * spreadsheet that matters.
 *
 * A negative *number* is exempt, and has to be: a balance column of `'-1.50` is text,
 * and a text column cannot be summed — which is the only reason anyone exports a CSV.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const disarmed = !NUMERIC.test(text) && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /["\n\r,;\t]/.test(disarmed) ? `"${disarmed.replaceAll('"', '""')}"` : disarmed;
}

/** A row, escaped and joined. No trailing newline — the writer owns line endings. */
export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

/**
 * Excel reads a CSV as the host's legacy code page unless the file says otherwise, so
 * an export of German names arrives as mojibake without this. Three bytes, prepended
 * once.
 */
export const CSV_BOM = '\uFEFF';

/**
 * A minute total as a decimal number of hours — `7.58` — for the export only.
 *
 * The screens print `H:MM`, which a spreadsheet cannot add up. The export is read by
 * a machine, so it gets a number; two decimals is finer than any timesheet resolves.
 */
export function csvHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}
