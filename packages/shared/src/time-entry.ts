/**
 * Time booked against a project or task — independent of attendance clock-in/out.
 *
 * A `TimeEntry` either runs (`startedAt` set, `endedAt` null, timed like the clock) or
 * is a manual booking (a plain duration, or a start/end pair typed in after the fact).
 * `rateAtEntry` and `amount` are frozen the moment they are known — at creation for a
 * manual entry, at stop time for a timer — and never recomputed from a project's
 * current rate later, the same frozen-cost discipline `absence.ts` uses for
 * `AbsenceRequest`. A later rate change must not rewrite what a past booking billed.
 */

export const TIME_ENTRY_SOURCES = ['timer', 'manual'] as const;

export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

export interface TimeEntrySummary {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskName: string | null;
  userId: string;
  /** `YYYY-MM-DD`, resolved from the user's zone when the entry was created. */
  localDate: string;
  /** Set for a timer-sourced entry (running or stopped); null for most manual entries. */
  startedAt: string | null;
  endedAt: string | null;
  /** Null exactly while a timer is running. */
  durationMinutes: number | null;
  billable: boolean;
  /** The rate frozen onto the entry, or null if it was booked with no rate resolved. */
  rateAtEntry: number | null;
  /** `rateAtEntry × durationMinutes / 60`, frozen once the duration is known. */
  amount: number | null;
  source: TimeEntrySource;
  note: string | null;
}

/** Whether a genuine timer is running — a duration-only manual entry is never "running". */
export function isTimeEntryRunning(
  entry: Pick<TimeEntrySummary, 'startedAt' | 'endedAt'>,
): boolean {
  return entry.startedAt !== null && entry.endedAt === null;
}

/**
 * `hourlyRate × minutes / 60`, rounded to the nearest cent.
 *
 * The one place this arithmetic happens, so the API can freeze `amount` with it and the
 * web can preview a running timer's live estimate with the same rounding rule before it
 * is ever stopped.
 */
export function amountFor(durationMinutes: number, hourlyRate: number): number {
  return Math.round(((hourlyRate * durationMinutes) / 60) * 100) / 100;
}

export interface StartTimerRequest {
  projectId: string;
  taskId?: string | null;
  note?: string | null;
}

/**
 * A manual booking. Exactly one of `durationMinutes` or the `startedAt`/`endedAt` pair
 * must be given — never both, never neither. The service is the one place that rule is
 * enforced (a class-validator `@ValidateIf` pair cannot itself express "exactly one of").
 */
export interface CreateManualTimeEntryRequest {
  projectId: string;
  taskId?: string | null;
  localDate: string;
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
  /** Defaults to `true`. */
  billable?: boolean;
  note?: string | null;
}

export interface UpdateTimeEntryRequest {
  projectId?: string;
  taskId?: string | null;
  localDate?: string;
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
  billable?: boolean;
  note?: string | null;
}
