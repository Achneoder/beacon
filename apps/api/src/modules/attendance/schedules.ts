import { defaultExpectedMinutes, type WorkScheduleSummary } from '@beacon/shared';
import type { WorkSchedule } from './work-schedule.entity.js';

/** The weekly hours a person gets until someone gives them a schedule of their own. */
export const FALLBACK_WEEKLY_MINUTES = 40 * 60;

/**
 * Resolving an effective-dated schedule, in memory.
 *
 * This used to be a query per day inside `AttendanceService.week()`, which is fine for
 * seven days and one person and is not fine for a quarter across an organization — a
 * report would have issued tens of thousands of round trips. The rows for the whole
 * span are loaded once and the "newest row on or before this day" decision is made
 * here, so the timesheet and the report share one definition of which contract applied
 * and one definition of the default when none did.
 *
 * `rows` must be sorted by `effectiveFrom` descending; both callers order the query
 * that way rather than re-sorting per day.
 */
export function scheduleInForce(
  rows: readonly WorkSchedule[],
  date: string,
): WorkScheduleSummary {
  const schedule = rows.find((row) => row.effectiveFrom <= date);

  return schedule ? toScheduleSummary(schedule) : fallbackSchedule(date);
}

/** Full time, five days, from the day asked about — nobody's target is unknowable. */
export function fallbackSchedule(date: string): WorkScheduleSummary {
  return {
    id: 'default',
    model: 'flextime',
    weeklyMinutes: FALLBACK_WEEKLY_MINUTES,
    expectedMinutes: defaultExpectedMinutes(FALLBACK_WEEKLY_MINUTES),
    coreStart: null,
    coreEnd: null,
    startTime: null,
    endTime: null,
    rosterRef: null,
    effectiveFrom: date,
  };
}

export function toScheduleSummary(schedule: WorkSchedule): WorkScheduleSummary {
  return {
    id: schedule.id,
    model: schedule.model,
    weeklyMinutes: schedule.weeklyMinutes,
    expectedMinutes: schedule.expectedMinutes,
    coreStart: schedule.coreStart,
    coreEnd: schedule.coreEnd,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    rosterRef: schedule.rosterRef,
    effectiveFrom: schedule.effectiveFrom,
  };
}
