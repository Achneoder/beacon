import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  dayBalance,
  datesBetween,
  fullName,
  minutesBetween,
  summarizeOvertime,
  targetMinutesFor,
  totalsOf,
  weekdayOf,
  type AbsenceSummary,
  type AbsenceSummaryRow,
  type AttendanceSummary,
  type AttendanceSummaryRow,
  type BillableGroupBy,
  type BillableSummary,
  type BillableSummaryRow,
  type ReportGroupBy,
  type ReportRange,
} from '@beacon/shared';
import { localDate, resolveTimezone } from '../../common/time/zone.js';
import { AbsencesService } from '../absences/absences.service.js';
import { AttendanceEntry } from '../attendance/attendance-entry.entity.js';
import { OvertimeBalance } from '../attendance/overtime-balance.entity.js';
import { WorkSchedule } from '../attendance/work-schedule.entity.js';
import { scheduleInForce } from '../attendance/schedules.js';
import { toSegments } from '../attendance/attendance.service.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { TimeEntry } from '../time-entries/time-entry.entity.js';

/** Who is asking, and how far the guard already let them see. */
export interface Caller {
  id: string;
  organizationId: string;
  /** True when the caller holds `attendance:approve` — they may report on everyone. */
  canApprove: boolean;
}

export interface AttendanceReportFilter {
  from?: string;
  to?: string;
  groupBy?: ReportGroupBy;
}

export interface BillableReportFilter {
  from?: string;
  to?: string;
  groupBy?: BillableGroupBy;
  projectId?: string;
}

/** The bucket a task-grouped or client-grouped row with neither falls into. */
const NO_TASK = 'No task';
const NO_CLIENT = 'No client';

/** The bucket a person with no department falls into, named rather than dropped. */
const UNASSIGNED = 'Unassigned';

/** One person's fold over the range, before it is grouped. */
interface Folded {
  user: User;
  row: AttendanceSummaryRow;
  /** Per-day figures, kept for the CSV — the summary itself never exposes them. */
  days: FoldedDay[];
}

interface FoldedDay {
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  expectedMinutes: number;
  creditedMinutes: number;
  balanceMinutes: number;
  absenceTag: string | null;
  holiday: string | null;
}

/**
 * Aggregation, and the only module that reads across people.
 *
 * Two rules shape everything here.
 *
 * **It reports from the entries, not from the `AttendanceDay` ledger.** That table
 * looks like the obvious source and says in its own docblock that it is not one: a row
 * exists only for a day that was clocked *out*, so a person who never clocked in on
 * Monday has no row at all. Summing the ledger would silently drop their expected
 * minutes and flatter every average it produced. The report recomputes from the same
 * three inputs the timesheet uses — entries, the effective-dated schedule, and absence
 * coverage — through the same shared arithmetic, so a figure here and a figure on
 * `/timesheet` cannot disagree.
 *
 * **Every lookup is batched.** `AttendanceService.week()` queries the schedule once per
 * day and the coverage once per person, which is right for seven days and one person
 * and would be tens of thousands of round trips for a quarter across an organization.
 * Each input is loaded once for the whole span and resolved in memory.
 *
 * It also **writes nothing**. `AttendanceService.balanceOf` and
 * `AbsencesService.balanceOf` both materialise a row on first read; a report that did
 * the same would create an overtime bank and a leave quota for every employee it
 * touched, and could block behind a clock-out while doing it. A missing row reports
 * its default.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly em: EntityManager,
    private readonly users: UsersService,
    private readonly absences: AbsencesService,
  ) {}

  async attendanceSummary(
    caller: Caller,
    filter: AttendanceReportFilter = {},
  ): Promise<AttendanceSummary> {
    const groupBy = filter.groupBy ?? 'user';
    const { range, folded, overtime } = await this.fold(caller, filter);

    const rows = groupBy === 'department' ? byDepartment(folded) : folded.map((one) => one.row);
    const total = totalRow(rows, folded.length);

    return {
      range,
      groupBy,
      rows,
      total,
      overtimeMinutes: [...overtime.values()].reduce((sum, row) => sum + row.balanceMinutes, 0),
      overCapCount: [...overtime.values()].filter(
        (row) => summarizeOvertime(row.balanceMinutes, row.capMinutes).overCap,
      ).length,
      headcount: folded.length,
    };
  }

  /**
   * The export, as rows rather than a string.
   *
   * One line per person per day — the grain a spreadsheet can pivot, which is the
   * whole reason anyone asks for a CSV rather than reading the table on screen. The
   * rows come back as a lazy iterable, not an array: the controller streams them, and
   * materialising the flat list up front would hold a year across an organization —
   * hundreds of thousands of row objects — in the heap before the first byte left.
   */
  async attendanceRows(
    caller: Caller,
    filter: AttendanceReportFilter = {},
  ): Promise<{ range: ReportRange; rows: Iterable<AttendanceCsvRow> }> {
    const { range, folded } = await this.fold(caller, filter);

    return { range, rows: csvRowsOf(folded) };
  }

  async absenceSummary(caller: Caller, year?: number): Promise<AbsenceSummary> {
    const subjects = await this.subjectsOf(caller);
    const timezone = await this.organizationTimezone(caller.organizationId);
    const today = localDate(timezone);
    const forYear = year ?? Number(today.slice(0, 4));

    const balances = await this.absences.balancesFor(
      caller.organizationId,
      subjects.map((user) => user.id),
      forYear,
      today,
    );

    const rows = subjects.map<AbsenceSummaryRow>((user) => ({
      userId: user.id,
      userName: fullName(user),
      departmentName: user.department?.getEntity().name ?? null,
      ...balances.get(user.id)!,
    }));

    return {
      year: forYear,
      rows,
      total: {
        entitlementDays: round(sum(rows, (row) => row.entitlementDays)),
        carryOverDays: round(sum(rows, (row) => row.carryOverDays)),
        takenDays: round(sum(rows, (row) => row.takenDays)),
        pendingDays: round(sum(rows, (row) => row.pendingDays)),
        remainingDays: round(sum(rows, (row) => row.remainingDays)),
      },
    };
  }

  /**
   * Billable hours and amount, for someone preparing invoices.
   *
   * Deliberately **not** narrowed by `subjectsOf` the way `attendanceSummary` and
   * `absenceSummary` are: every `report:read` holder sees the whole organization's
   * billable time, because preparing an invoice is an org-wide task, not a per-team
   * one. In the shipped `DEFAULT_ROLES` every `report:read` holder also holds
   * `attendance:approve`, so this makes no visible difference today — it only matters
   * for a narrower custom role holding `report:read` alone, where the un-narrowed
   * total is the correct one.
   *
   * `amount` only ever sums each entry's frozen `TimeEntry.amount` — never a live
   * estimate off a project's current rate — so a row here always matches what was
   * actually billed. A still-running entry still contributes its live minutes to
   * `minutes`, via the same `minutesBetween` the timesheet uses for a running segment,
   * but nothing to `amount` until it is stopped and the amount is frozen.
   */
  async billableSummary(caller: Caller, filter: BillableReportFilter = {}): Promise<BillableSummary> {
    const groupBy = filter.groupBy ?? 'project';
    const timezone = await this.organizationTimezone(caller.organizationId);
    const { from, to } = resolveRange(filter, localDate(timezone));
    const range: ReportRange = { from, to, timezone };

    const entries = await this.em.find(
      TimeEntry,
      {
        organization: caller.organizationId,
        localDate: { $gte: from, $lte: to },
        ...(filter.projectId ? { project: filter.projectId } : {}),
      },
      { populate: ['project', 'task', 'user'] },
    );

    const now = new Date();
    const rows = new Map<string, BillableSummaryRow>();
    let runningCount = 0;

    for (const entry of entries) {
      const running = entry.startedAt !== null && entry.endedAt === null;
      if (running) runningCount += 1;

      const minutes = entry.durationMinutes ?? (running ? minutesBetween(entry.startedAt!, now) : 0);
      const { key, label } = groupKeyOf(groupBy, entry);
      const mapKey = key ?? '';

      const row = rows.get(mapKey) ?? {
        key,
        label,
        minutes: 0,
        billableMinutes: 0,
        amount: 0,
        unratedMinutes: 0,
        entryCount: 0,
      };
      row.minutes += minutes;
      row.entryCount += 1;
      if (entry.billable) {
        row.billableMinutes += minutes;
        if (entry.amount !== null) row.amount += entry.amount;
        if (entry.rateAtEntry === null) row.unratedMinutes += minutes;
      }
      rows.set(mapKey, row);
    }

    const sorted = [...rows.values()]
      .map((row) => ({ ...row, amount: round(row.amount) }))
      .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));

    return {
      range,
      groupBy,
      rows: sorted,
      total: {
        key: null,
        label: '',
        minutes: sum(sorted, (row) => row.minutes),
        billableMinutes: sum(sorted, (row) => row.billableMinutes),
        amount: round(sum(sorted, (row) => row.amount)),
        unratedMinutes: sum(sorted, (row) => row.unratedMinutes),
        entryCount: sum(sorted, (row) => row.entryCount),
      },
      runningCount,
    };
  }

  // ---------------------------------------------------------------- internals

  /**
   * The whole range folded per person: five queries, whatever the headcount and
   * however long the span.
   */
  private async fold(
    caller: Caller,
    filter: AttendanceReportFilter,
  ): Promise<{
    range: ReportRange;
    folded: Folded[];
    overtime: Map<string, OvertimeBalance>;
  }> {
    const subjects = await this.subjectsOf(caller);
    const timezone = await this.organizationTimezone(caller.organizationId);
    const { from, to } = resolveRange(filter, localDate(timezone));
    const range: ReportRange = { from, to, timezone };
    const ids = subjects.map((user) => user.id);

    if (ids.length === 0) return { range, folded: [], overtime: new Map() };

    const [entries, schedules, coverage, overtimeRows, holidays] = await Promise.all([
      this.em.find(
        AttendanceEntry,
        {
          organization: caller.organizationId,
          user: { $in: ids },
          localDate: { $gte: from, $lte: to },
          approvalStatus: { $ne: 'rejected' },
        },
        { populate: ['breaks'], orderBy: { startedAt: 'asc' } },
      ),
      this.em.find(
        WorkSchedule,
        {
          organization: caller.organizationId,
          user: { $in: ids },
          effectiveFrom: { $lte: to },
        },
        { orderBy: { effectiveFrom: 'desc' } },
      ),
      this.absences.coverageOfMany(caller.organizationId, ids, from, to),
      this.em.find(OvertimeBalance, { organization: caller.organizationId, user: { $in: ids } }),
      this.absences.listHolidays(caller.organizationId, from, to),
    ]);

    const entriesByUser = bucket(entries, (entry) => entry.user.id);
    const schedulesByUser = bucket(schedules, (schedule) => schedule.user.id);
    const overtime = new Map(overtimeRows.map((row) => [row.user.id, row]));
    const holidayNames = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
    const dates = datesBetween(from, to);

    const folded = subjects.map((user) =>
      foldUser({
        user,
        dates,
        entries: entriesByUser.get(user.id) ?? [],
        schedules: schedulesByUser.get(user.id) ?? [],
        coverage: coverage.get(user.id) ?? new Map(),
        holidays: holidayNames,
        overtime: overtime.get(user.id) ?? null,
      }),
    );

    return { range, folded, overtime };
  }

  /**
   * Whose numbers the caller gets.
   *
   * `report:read` says *whether* they may see a report; it does not say whose, and the
   * service narrows exactly as `AttendanceService.resolveSubject` does — themselves and
   * their direct reports, widened to the organization by `attendance:approve`. A
   * manager's reach is then the same wherever they look, which is the point.
   *
   * Disabled accounts are included deliberately: someone who left in February still
   * worked in January, and a quarter that quietly omitted them would not add up.
   */
  private async subjectsOf(caller: Caller): Promise<User[]> {
    const ids = caller.canApprove
      ? undefined
      : [caller.id, ...(await this.users.subordinateIdsOf(caller.organizationId, caller.id))];

    return this.em.find(
      User,
      { organization: caller.organizationId, ...(ids ? { id: { $in: ids } } : {}) },
      { populate: ['department'], orderBy: { lastName: 'asc', firstName: 'asc' } },
    );
  }

  /**
   * The organization's zone, not each subject's.
   *
   * A report puts many people in one table, and a table whose rows each ended on a
   * different Tuesday would not add up. Every subject's days are cut on the
   * organization's calendar, and the range says which zone that was.
   */
  private async organizationTimezone(organizationId: string): Promise<string> {
    const organization = await this.em.findOne(Organization, { id: organizationId });

    return resolveTimezone(null, organization?.timezone ?? 'UTC');
  }
}

/** One line of the export. */
export interface AttendanceCsvRow extends FoldedDay {
  employeeNumber: string | null;
  name: string;
  email: string;
  department: string | null;
}

/**
 * The folded report, flattened one row at a time as the consumer asks for them.
 *
 * Kept lazy on purpose: `attendanceCsvStream` feeds these to a socket a chunk at a
 * time, and the alternative — `folded.flatMap` over every person's every day — would
 * build the whole file's worth of row objects before the header had been written.
 */
function* csvRowsOf(folded: Folded[]): Generator<AttendanceCsvRow> {
  for (const one of folded) {
    for (const day of one.days) {
      yield {
        employeeNumber: one.user.employeeNumber,
        name: fullName(one.user),
        email: one.user.email,
        department: one.user.department?.getEntity().name ?? null,
        ...day,
      };
    }
  }
}

/**
 * One person's range, day by day.
 *
 * The day arithmetic is the shared `totalsOf` / `targetMinutesFor` / `dayBalance` the
 * timesheet already uses. One rule below is now shared with it too, and one is still
 * this function's own:
 *
 * - **A public holiday expects nothing.** `AttendanceService` reads the same calendar
 *   now (`holidaysBetween`, mirroring the `holidays` map below), so this is no longer
 *   a divergence the report papers over — a timesheet week containing Christmas prints
 *   a zero target too, and `Migration20260829150000` restated the balances the old
 *   rule had already banked. Hours actually worked on a holiday still count as worked,
 *   so the day reads as pure overtime, which is what it is.
 * - **A credited day is credited at most up to its target.** `creditedMinutes` is what
 *   the absence supplied *instead of* work, so worked + credited − expected is always
 *   the balance, whether the person was off, at home, or clocked in on a day off.
 */
function foldUser(input: {
  user: User;
  dates: string[];
  entries: AttendanceEntry[];
  schedules: WorkSchedule[];
  coverage: Map<string, { tag: string; credited: boolean }>;
  holidays: Map<string, string>;
  overtime: OvertimeBalance | null;
}): Folded {
  const entriesByDate = bucket(input.entries, (entry) => entry.localDate);
  const days: FoldedDay[] = [];

  for (const date of input.dates) {
    const forDay = entriesByDate.get(date) ?? [];
    const { workedMinutes, breakMinutes } = totalsOf(forDay.flatMap((entry) => toSegments(entry)));

    const holiday = input.holidays.get(date) ?? null;
    const schedule = scheduleInForce(input.schedules, date);
    const expectedMinutes = holiday ? 0 : targetMinutesFor(schedule, weekdayOf(date));

    const absence = input.coverage.get(date) ?? null;
    const credited = !holiday && (absence?.credited ?? false);

    days.push({
      date,
      workedMinutes,
      breakMinutes,
      expectedMinutes,
      creditedMinutes: credited ? Math.max(0, expectedMinutes - workedMinutes) : 0,
      balanceMinutes: dayBalance(workedMinutes, expectedMinutes, credited),
      absenceTag: absence?.tag ?? null,
      holiday,
    });
  }

  return {
    user: input.user,
    days,
    row: {
      subjectId: input.user.id,
      subjectName: fullName(input.user),
      headcount: 1,
      workedMinutes: sum(days, (day) => day.workedMinutes),
      breakMinutes: sum(days, (day) => day.breakMinutes),
      expectedMinutes: sum(days, (day) => day.expectedMinutes),
      creditedMinutes: sum(days, (day) => day.creditedMinutes),
      balanceMinutes: sum(days, (day) => day.balanceMinutes),
      daysWorked: days.filter((day) => day.workedMinutes > 0).length,
      daysAbsent: days.filter((day) => day.absenceTag !== null).length,
      overtime: input.overtime
        ? summarizeOvertime(input.overtime.balanceMinutes, input.overtime.capMinutes)
        : null,
    },
  };
}

/**
 * Rolled up by department, with everyone who has none in a single named bucket rather
 * than dropped — a total that quietly excluded the unassigned would not match the
 * per-person view of the same range.
 *
 * The overtime bank is `null` on a department row: it is a lifetime figure per person,
 * and a sum of lifetime banks answers no question anyone asked.
 */
function byDepartment(folded: Folded[]): AttendanceSummaryRow[] {
  const groups = new Map<string, { name: string; rows: AttendanceSummaryRow[] }>();

  for (const one of folded) {
    const department = one.user.department?.getEntity() ?? null;
    const key = department?.id ?? '';
    const group = groups.get(key) ?? { name: department?.name ?? UNASSIGNED, rows: [] };

    group.rows.push(one.row);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      ...totalRow(group.rows, group.rows.length),
      subjectId: id || null,
      subjectName: group.name,
    }))
    .sort((left, right) => left.subjectName.localeCompare(right.subjectName));
}

function totalRow(rows: AttendanceSummaryRow[], headcount: number): AttendanceSummaryRow {
  return {
    subjectId: null,
    subjectName: '',
    headcount,
    workedMinutes: sum(rows, (row) => row.workedMinutes),
    breakMinutes: sum(rows, (row) => row.breakMinutes),
    expectedMinutes: sum(rows, (row) => row.expectedMinutes),
    creditedMinutes: sum(rows, (row) => row.creditedMinutes),
    balanceMinutes: sum(rows, (row) => row.balanceMinutes),
    daysWorked: sum(rows, (row) => row.daysWorked),
    daysAbsent: sum(rows, (row) => row.daysAbsent),
    overtime: null,
  };
}

/** Requires `project`, `task` and `user` to be populated. */
function groupKeyOf(groupBy: BillableGroupBy, entry: TimeEntry): { key: string | null; label: string } {
  const project = entry.project.getEntity();

  switch (groupBy) {
    case 'project':
      return { key: project.id, label: project.name };
    case 'task': {
      const task = entry.task?.getEntity() ?? null;
      return task ? { key: task.id, label: task.name } : { key: null, label: NO_TASK };
    }
    case 'client':
      return project.clientName
        ? { key: project.clientName, label: project.clientName }
        : { key: null, label: NO_CLIENT };
    case 'user': {
      const user = entry.user.getEntity();
      return { key: user.id, label: fullName(user) };
    }
  }
}

/**
 * The range, defaulting to the month containing today.
 *
 * A backwards range yields no dates rather than an error: `datesBetween` already
 * returns nothing, and a report of nothing is a truthful answer to a nonsense span.
 */
export function resolveRange(
  filter: { from?: string; to?: string },
  today: string,
): { from: string; to: string } {
  const to = filter.to ?? today;
  const from = filter.from ?? `${to.slice(0, 7)}-01`;

  return { from, to };
}

function bucket<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const buckets = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const existing = buckets.get(key);
    if (existing) existing.push(item);
    else buckets.set(key, [item]);
  }

  return buckets;
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

/** Two decimals: half days are the finest fraction the quota columns carry, and money never needs a third. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
