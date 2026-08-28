import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayBalance,
  dayProgress,
  defaultExpectedMinutes,
  isRunning,
  isWeekLocked,
  minutesBetween,
  startOfWeek,
  summarizeOvertime,
  targetMinutesFor,
  totalsOf,
  weekDates,
  weekLocksAt,
  weekdayOf,
  type AttendanceSegment,
  type WorkScheduleSummary,
} from './attendance.js';

function segment(overrides: Partial<AttendanceSegment> = {}): AttendanceSegment {
  return {
    id: 'seg',
    kind: 'work',
    startedAt: '2026-08-28T07:00:00.000Z',
    endedAt: '2026-08-28T12:00:00.000Z',
    source: 'web',
    note: null,
    approvalStatus: 'approved',
    durationMinutes: null,
    ...overrides,
  };
}

describe('isRunning', () => {
  it('pulses while clocked in or on break, but not when out', () => {
    expect(isRunning('in')).toBe(true);
    expect(isRunning('break')).toBe(true);
    expect(isRunning('out')).toBe(false);
  });
});

describe('minutesBetween', () => {
  it('rounds to the nearest minute', () => {
    expect(minutesBetween('2026-08-28T07:00:00Z', '2026-08-28T12:35:29Z')).toBe(335);
  });

  it('never returns a negative span', () => {
    expect(minutesBetween('2026-08-28T12:00:00Z', '2026-08-28T07:00:00Z')).toBe(0);
  });
});

describe('totalsOf', () => {
  it('subtracts breaks from worked time rather than adding them', () => {
    const totals = totalsOf([
      segment(),
      segment({
        id: 'break',
        kind: 'break',
        startedAt: '2026-08-28T09:00:00.000Z',
        endedAt: '2026-08-28T09:30:00.000Z',
      }),
    ]);

    expect(totals).toEqual({ workedMinutes: 270, breakMinutes: 30 });
  });

  it('counts a running segment up to now', () => {
    const totals = totalsOf(
      [segment({ endedAt: null })],
      new Date('2026-08-28T08:45:00.000Z'),
    );

    expect(totals.workedMinutes).toBe(105);
  });

  it('prefers a server-supplied duration over recomputing it', () => {
    expect(totalsOf([segment({ durationMinutes: 42 })]).workedMinutes).toBe(42);
  });
});

describe('schedules', () => {
  const schedule: WorkScheduleSummary = {
    id: 'sched',
    model: 'flextime',
    weeklyMinutes: 1800,
    expectedMinutes: defaultExpectedMinutes(1800),
    coreStart: '10:00',
    coreEnd: '15:00',
    startTime: null,
    endTime: null,
    rosterRef: null,
    effectiveFrom: '2026-01-01',
  };

  it('splits a weekly figure over five days and leaves the weekend empty', () => {
    expect(schedule.expectedMinutes).toEqual([360, 360, 360, 360, 360, 0, 0]);
  });

  it('reads the target for a named weekday', () => {
    expect(targetMinutesFor(schedule, 'wednesday')).toBe(360);
    expect(targetMinutesFor(schedule, 'sunday')).toBe(0);
  });

  it('handles part-time hours that do not divide evenly', () => {
    expect(defaultExpectedMinutes(1350)).toEqual([270, 270, 270, 270, 270, 0, 0]);
  });
});

describe('summarizeOvertime', () => {
  it('stays inside the cap', () => {
    expect(summarizeOvertime(860, 2400)).toEqual({
      balanceMinutes: 860,
      capMinutes: 2400,
      overCap: false,
      overCapMinutes: 0,
    });
  });

  it('keeps accruing past the cap and says by how much', () => {
    expect(summarizeOvertime(2540, 2400)).toEqual({
      balanceMinutes: 2540,
      capMinutes: 2400,
      overCap: true,
      overCapMinutes: 140,
    });
  });
});

describe('dayProgress', () => {
  it('clamps at a full bar rather than overflowing', () => {
    expect(dayProgress(227, 360)).toBeCloseTo(0.6306, 3);
    expect(dayProgress(480, 360)).toBe(1);
    expect(dayProgress(0, 360)).toBe(0);
  });

  it('reads a worked minute on a zero-target day as complete', () => {
    expect(dayProgress(30, 0)).toBe(1);
    expect(dayProgress(0, 0)).toBe(0);
  });
});

describe('dayBalance', () => {
  it('is worked minus target on an ordinary day', () => {
    expect(dayBalance(335, 360, false)).toBe(-25);
    expect(dayBalance(420, 360, false)).toBe(60);
  });

  it('credits an absence day at target instead of counting it as worked', () => {
    expect(dayBalance(0, 360, true)).toBe(0);
  });

  it('still rewards real hours worked on a credited day', () => {
    expect(dayBalance(400, 360, true)).toBe(40);
  });
});

describe('week arithmetic', () => {
  it('names the weekday Monday-first', () => {
    expect(weekdayOf('2026-08-28')).toBe('friday');
    expect(weekdayOf('2026-08-30')).toBe('sunday');
    expect(weekdayOf('2026-08-31')).toBe('monday');
  });

  it('walks back to Monday, including from a Sunday', () => {
    expect(startOfWeek('2026-08-28')).toBe('2026-08-24');
    expect(startOfWeek('2026-08-30')).toBe('2026-08-24');
    expect(startOfWeek('2026-08-24')).toBe('2026-08-24');
  });

  it('crosses a month boundary when shifting days', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('lists the seven dates of a week', () => {
    expect(weekDates('2026-08-24')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });
});

describe('the week lock', () => {
  it('stays unlocked until 09:00 on the following Monday', () => {
    const monday = '2026-08-24';

    expect(weekLocksAt(monday).toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(isWeekLocked(monday, new Date('2026-09-01T08:59:00Z'))).toBe(false);
    expect(isWeekLocked(monday, new Date('2026-09-01T09:00:00Z'))).toBe(true);
  });

  it('means 09:00 where the person works, not 09:00 UTC', () => {
    // Berlin in summer is UTC+2, so the lock lands two hours earlier in UTC.
    expect(weekLocksAt('2026-08-24', 120).toISOString()).toBe('2026-09-01T07:00:00.000Z');
  });

  it('leaves the current week unlocked', () => {
    expect(isWeekLocked('2026-08-24', new Date('2026-08-28T17:00:00Z'))).toBe(false);
  });
});
