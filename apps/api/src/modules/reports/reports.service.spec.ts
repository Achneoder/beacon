import { describe, expect, it, vi } from 'vitest';
import type { LeaveBalanceSummary } from '@beacon/shared';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AbsencesService, DayCoverage } from '../absences/absences.service.js';
import type { UsersService } from '../users/users.service.js';
import { AttendanceEntry } from '../attendance/attendance-entry.entity.js';
import { OvertimeBalance } from '../attendance/overtime-balance.entity.js';
import { WorkSchedule } from '../attendance/work-schedule.entity.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { ReportsService, type Caller } from './reports.service.js';

/**
 * The claims this spec exists for, in one line each:
 *
 * - a day nobody clocked still costs its target — the bug the `AttendanceDay` ledger
 *   would have shipped, because that table has no row for a day never clocked out;
 * - an absence is credited, not counted as worked, and not booked as a shortfall;
 * - a public holiday expects nothing, and hours worked on one are pure overtime;
 * - reading a report writes nothing;
 * - `report:read` does not widen who a caller may see.
 *
 * The doubles are deliberately thin: the arithmetic is the thing under test, and it is
 * shared with the timesheet, so anything mocked here would be mocking the answer.
 */

// Monday to Friday of a full working week in 2026.
const MONDAY = '2026-08-03';
const FRIDAY = '2026-08-07';
/** The full-time fallback: 40 h over five days. */
const FULL_DAY = 480;

interface Person {
  id: string;
  name?: string;
  departmentId?: string;
  departmentName?: string;
}

function userDouble(person: Person): User {
  const [firstName, lastName] = (person.name ?? 'Ada Lovelace').split(' ');

  return {
    id: person.id,
    firstName,
    lastName,
    email: `${person.id}@beacon.test`,
    employeeNumber: 'BCN-0001',
    department: person.departmentId
      ? { id: person.departmentId, getEntity: () => ({ id: person.departmentId, name: person.departmentName }) }
      : null,
  } as unknown as User;
}

/** A closed entry with an optional break, as `toSegments` expects to find it. */
function entryDouble(input: {
  userId: string;
  date: string;
  minutes: number;
  breakMinutes?: number;
}): AttendanceEntry {
  const startedAt = new Date(`${input.date}T08:00:00Z`);
  const breakMinutes = input.breakMinutes ?? 0;
  const endedAt = new Date(startedAt.getTime() + (input.minutes + breakMinutes) * 60_000);
  const breaks = breakMinutes
    ? [
        {
          id: `${input.userId}-${input.date}-break`,
          startedAt,
          endedAt: new Date(startedAt.getTime() + breakMinutes * 60_000),
        },
      ]
    : [];

  return {
    id: `${input.userId}-${input.date}`,
    user: { id: input.userId },
    localDate: input.date,
    startedAt,
    endedAt,
    source: 'web',
    note: null,
    approvalStatus: 'approved',
    breaks: { getItems: () => breaks },
  } as unknown as AttendanceEntry;
}

function overtimeDouble(userId: string, balanceMinutes: number, capMinutes = 2400): OvertimeBalance {
  return { user: { id: userId }, balanceMinutes, capMinutes } as unknown as OvertimeBalance;
}

interface World {
  users: User[];
  entries?: AttendanceEntry[];
  schedules?: WorkSchedule[];
  overtime?: OvertimeBalance[];
}

function emDouble(world: World) {
  const find = vi.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === User) {
      const ids = (where.id as { $in?: string[] } | undefined)?.$in;

      return ids ? world.users.filter((user) => ids.includes(user.id)) : world.users;
    }
    if (entity === AttendanceEntry) return world.entries ?? [];
    if (entity === WorkSchedule) return world.schedules ?? [];
    if (entity === OvertimeBalance) return world.overtime ?? [];

    throw new Error(`unexpected find on ${String(entity)}`);
  });

  const em = {
    find,
    findOne: vi.fn(async (entity: unknown) =>
      entity === Organization ? ({ id: 'org-1', timezone: 'UTC' } as Organization) : null,
    ),
    // A report must not write. Anything reaching these is the bug.
    create: vi.fn(() => {
      throw new Error('a report must not create rows');
    }),
    persist: vi.fn(() => {
      throw new Error('a report must not persist rows');
    }),
    flush: vi.fn(() => {
      throw new Error('a report must not flush');
    }),
  };

  return em as unknown as EntityManager & typeof em;
}

function absencesDouble(input: {
  coverage?: Record<string, DayCoverage>;
  holidays?: { date: string; name: string }[];
  balances?: Record<string, LeaveBalanceSummary>;
} = {}) {
  return {
    coverageOfMany: vi.fn(
      async (_organizationId: string, ids: readonly string[]) =>
        new Map(ids.map((id) => [id, input.coverage?.[id] ?? new Map()])),
    ),
    listHolidays: vi.fn(async () => input.holidays ?? []),
    balancesFor: vi.fn(
      async (_organizationId: string, ids: readonly string[]) =>
        new Map(ids.map((id) => [id, input.balances?.[id] ?? emptyBalance()])),
    ),
  } as unknown as AbsencesService & { coverageOfMany: ReturnType<typeof vi.fn> };
}

function emptyBalance(): LeaveBalanceSummary {
  return {
    year: 2026,
    entitlementDays: 30,
    carryOverDays: 0,
    carryOverExpiresOn: null,
    takenDays: 0,
    pendingDays: 0,
    remainingDays: 30,
  };
}

function usersDouble(subordinates: string[] = []) {
  return {
    subordinateIdsOf: vi.fn(async () => subordinates),
  } as unknown as UsersService & { subordinateIdsOf: ReturnType<typeof vi.fn> };
}

function caller(overrides: Partial<Caller> = {}): Caller {
  return { id: 'me', organizationId: 'org-1', canApprove: true, ...overrides };
}

const RANGE = { from: MONDAY, to: FRIDAY };

describe('ReportsService.attendanceSummary', () => {
  it('charges a target for a day nobody clocked', async () => {
    // The reason this reads the entries and not `AttendanceDay`: the ledger has no row
    // for a day that was never clocked out, so summing it would drop the whole week's
    // expectation and report a person who worked nothing as exactly on target.
    const service = new ReportsService(
      emDouble({ users: [userDouble({ id: 'u1' })] }),
      usersDouble(),
      absencesDouble(),
    );

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      workedMinutes: 0,
      expectedMinutes: 5 * FULL_DAY,
      balanceMinutes: -5 * FULL_DAY,
      daysWorked: 0,
    });
  });

  it('credits an absence day rather than booking it as a shortfall', async () => {
    const coverage: DayCoverage = new Map([
      ['2026-08-05', { tag: 'Vacation', credited: true }],
    ]);
    const service = new ReportsService(
      emDouble({ users: [userDouble({ id: 'u1' })] }),
      usersDouble(),
      absencesDouble({ coverage: { u1: coverage } }),
    );

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.rows[0]).toMatchObject({
      workedMinutes: 0,
      creditedMinutes: FULL_DAY,
      // Four unclocked days, not five: the day off met its target.
      balanceMinutes: -4 * FULL_DAY,
      daysAbsent: 1,
    });
  });

  it('counts a home-office day as worked and still tags it', async () => {
    // `countsAsWork` types are working days that appear on the calendar. They are
    // tagged and they are not credited — the hours have to be real.
    const coverage: DayCoverage = new Map([
      ['2026-08-05', { tag: 'Home office', credited: false }],
    ]);
    const service = new ReportsService(
      emDouble({
        users: [userDouble({ id: 'u1' })],
        entries: [entryDouble({ userId: 'u1', date: '2026-08-05', minutes: 335 })],
      }),
      usersDouble(),
      absencesDouble({ coverage: { u1: coverage } }),
    );

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.rows[0]).toMatchObject({
      workedMinutes: 335,
      creditedMinutes: 0,
      daysWorked: 1,
      daysAbsent: 1,
    });
  });

  it('expects nothing on a public holiday, and reads hours worked on one as overtime', async () => {
    const service = new ReportsService(
      emDouble({
        users: [userDouble({ id: 'u1' })],
        entries: [entryDouble({ userId: 'u1', date: '2026-08-05', minutes: 180 })],
      }),
      usersDouble(),
      absencesDouble({ holidays: [{ date: '2026-08-05', name: 'Assumption Day' }] }),
    );

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.rows[0]).toMatchObject({
      expectedMinutes: 4 * FULL_DAY,
      workedMinutes: 180,
      balanceMinutes: 180 - 4 * FULL_DAY,
    });
  });

  it('subtracts a break from worked time exactly once', async () => {
    const service = new ReportsService(
      emDouble({
        users: [userDouble({ id: 'u1' })],
        entries: [
          entryDouble({ userId: 'u1', date: '2026-08-03', minutes: 480, breakMinutes: 30 }),
        ],
      }),
      usersDouble(),
      absencesDouble(),
    );

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.rows[0]).toMatchObject({ workedMinutes: 480, breakMinutes: 30 });
  });

  it('keeps worked + credited - expected equal to the balance, whatever the day was', async () => {
    // The invariant the whole fold rests on. If it ever fails, one of the three
    // columns on the screen is lying about the other two.
    const coverage: DayCoverage = new Map([
      ['2026-08-04', { tag: 'Vacation', credited: true }],
      ['2026-08-05', { tag: 'Home office', credited: false }],
      // Clocked in on a day off — rare, and the case that breaks a naive credit.
      ['2026-08-06', { tag: 'Vacation', credited: true }],
    ]);
    const service = new ReportsService(
      emDouble({
        users: [userDouble({ id: 'u1' })],
        entries: [
          entryDouble({ userId: 'u1', date: '2026-08-03', minutes: 500 }),
          entryDouble({ userId: 'u1', date: '2026-08-05', minutes: 300 }),
          entryDouble({ userId: 'u1', date: '2026-08-06', minutes: 600 }),
        ],
      }),
      usersDouble(),
      absencesDouble({
        coverage: { u1: coverage },
        holidays: [{ date: '2026-08-07', name: 'A holiday' }],
      }),
    );

    const { rows, total } = await service.attendanceSummary(caller(), RANGE);

    for (const row of [...rows, total]) {
      expect(row.workedMinutes + row.creditedMinutes - row.expectedMinutes).toBe(
        row.balanceMinutes,
      );
    }
  });

  it('rolls up by department and names the unassigned bucket rather than dropping it', async () => {
    const service = new ReportsService(
      emDouble({
        users: [
          userDouble({ id: 'u1', name: 'Ada Lovelace', departmentId: 'd1', departmentName: 'Engineering' }),
          userDouble({ id: 'u2', name: 'Grace Hopper', departmentId: 'd1', departmentName: 'Engineering' }),
          userDouble({ id: 'u3', name: 'Alan Turing' }),
        ],
        entries: [
          entryDouble({ userId: 'u1', date: '2026-08-03', minutes: 480 }),
          entryDouble({ userId: 'u2', date: '2026-08-03', minutes: 240 }),
          entryDouble({ userId: 'u3', date: '2026-08-03', minutes: 60 }),
        ],
      }),
      usersDouble(),
      absencesDouble(),
    );

    const summary = await service.attendanceSummary(caller(), { ...RANGE, groupBy: 'department' });

    expect(summary.rows.map((row) => [row.subjectName, row.headcount, row.workedMinutes])).toEqual([
      ['Engineering', 2, 720],
      ['Unassigned', 1, 60],
    ]);
    // Whatever the grouping, the total is over everyone.
    expect(summary.total.workedMinutes).toBe(780);
    expect(summary.total.headcount).toBe(3);
  });

  it('reports no overtime bank for someone who has never had one, and creates none', async () => {
    const em = emDouble({
      users: [userDouble({ id: 'u1' }), userDouble({ id: 'u2' })],
      overtime: [overtimeDouble('u1', 860)],
    });
    const service = new ReportsService(em, usersDouble(), absencesDouble());

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.rows[0].overtime).toMatchObject({ balanceMinutes: 860, overCap: false });
    expect(summary.rows[1].overtime).toBeNull();
    expect(em.create).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('sums the overtime bank across everyone and counts who is over their cap', async () => {
    const service = new ReportsService(
      emDouble({
        users: [userDouble({ id: 'u1' }), userDouble({ id: 'u2' })],
        overtime: [overtimeDouble('u1', 2500), overtimeDouble('u2', 100)],
      }),
      usersDouble(),
      absencesDouble(),
    );

    const summary = await service.attendanceSummary(caller(), RANGE);

    expect(summary.overtimeMinutes).toBe(2600);
    expect(summary.overCapCount).toBe(1);
    // A department row carries no bank: summing lifetime balances answers nothing.
    const grouped = await service.attendanceSummary(caller(), { ...RANGE, groupBy: 'department' });
    expect(grouped.rows.every((row) => row.overtime === null)).toBe(true);
    expect(grouped.overtimeMinutes).toBe(2600);
  });

  it('narrows a caller who cannot approve to themselves and their reports', async () => {
    const em = emDouble({
      users: [userDouble({ id: 'me' }), userDouble({ id: 'report-1' })],
    });
    const service = new ReportsService(em, usersDouble(['report-1']), absencesDouble());

    const summary = await service.attendanceSummary(caller({ canApprove: false }), RANGE);

    expect(em.find).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ id: { $in: ['me', 'report-1'] } }),
      expect.anything(),
    );
    expect(summary.rows.map((row) => row.subjectId)).toEqual(['me', 'report-1']);
  });

  it('reads everyone once the caller can approve', async () => {
    const users = usersDouble();
    const em = emDouble({ users: [userDouble({ id: 'u1' })] });
    const service = new ReportsService(em, users, absencesDouble());

    await service.attendanceSummary(caller({ canApprove: true }), RANGE);

    expect(users.subordinateIdsOf).not.toHaveBeenCalled();
    expect(em.find).toHaveBeenCalledWith(
      User,
      expect.not.objectContaining({ id: expect.anything() }),
      expect.anything(),
    );
  });

  it('defaults the range to the month containing today', async () => {
    const absences = absencesDouble();
    const service = new ReportsService(
      emDouble({ users: [userDouble({ id: 'u1' })] }),
      usersDouble(),
      absences,
    );

    const summary = await service.attendanceSummary(caller());

    expect(summary.range.from).toBe(`${summary.range.to.slice(0, 7)}-01`);
    expect(summary.range.timezone).toBe('UTC');
  });

  it('answers a backwards range with nothing rather than an error', async () => {
    const service = new ReportsService(
      emDouble({ users: [userDouble({ id: 'u1' })] }),
      usersDouble(),
      absencesDouble(),
    );

    const summary = await service.attendanceSummary(caller(), { from: FRIDAY, to: MONDAY });

    expect(summary.rows[0]).toMatchObject({ expectedMinutes: 0, workedMinutes: 0 });
  });
});

describe('ReportsService.attendanceRows', () => {
  it('emits one row per person per day, carrying the tag and the holiday', async () => {
    const coverage: DayCoverage = new Map([
      ['2026-08-04', { tag: 'Vacation', credited: true }],
    ]);
    const service = new ReportsService(
      emDouble({
        users: [userDouble({ id: 'u1', departmentId: 'd1', departmentName: 'Engineering' })],
        entries: [entryDouble({ userId: 'u1', date: '2026-08-03', minutes: 455 })],
      }),
      usersDouble(),
      absencesDouble({
        coverage: { u1: coverage },
        holidays: [{ date: '2026-08-07', name: 'A holiday' }],
      }),
    );

    const { rows } = await service.attendanceRows(caller(), RANGE);
    const materialized = [...rows];

    expect(materialized).toHaveLength(5);
    expect(materialized[0]).toMatchObject({
      name: 'Ada Lovelace',
      department: 'Engineering',
      date: '2026-08-03',
      workedMinutes: 455,
    });
    expect(materialized[1]).toMatchObject({ absenceTag: 'Vacation', creditedMinutes: 480 });
    expect(materialized[4]).toMatchObject({ holiday: 'A holiday', expectedMinutes: 0 });
  });
});

describe('ReportsService.absenceSummary', () => {
  it('reports a quota per person and sums the columns', async () => {
    const service = new ReportsService(
      emDouble({
        users: [
          userDouble({ id: 'u1', name: 'Ada Lovelace', departmentId: 'd1', departmentName: 'Engineering' }),
          userDouble({ id: 'u2', name: 'Grace Hopper' }),
        ],
      }),
      usersDouble(),
      absencesDouble({
        balances: {
          u1: { ...emptyBalance(), takenDays: 12, pendingDays: 2, remainingDays: 18 },
          u2: { ...emptyBalance(), takenDays: 5, remainingDays: 25 },
        },
      }),
    );

    const summary = await service.absenceSummary(caller(), 2026);

    expect(summary.year).toBe(2026);
    expect(summary.rows.map((row) => [row.userName, row.departmentName, row.takenDays])).toEqual([
      ['Ada Lovelace', 'Engineering', 12],
      ['Grace Hopper', null, 5],
    ]);
    expect(summary.total).toEqual({
      entitlementDays: 60,
      carryOverDays: 0,
      takenDays: 17,
      pendingDays: 2,
      remainingDays: 43,
    });
  });

  it('narrows to the caller and their reports without approve', async () => {
    const em = emDouble({ users: [userDouble({ id: 'me' })] });
    const service = new ReportsService(em, usersDouble([]), absencesDouble());

    await service.absenceSummary(caller({ canApprove: false }), 2026);

    expect(em.find).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ id: { $in: ['me'] } }),
      expect.anything(),
    );
  });
});
