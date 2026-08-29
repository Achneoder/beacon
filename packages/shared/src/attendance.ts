/**
 * Attendance: the clock, the segments it produces, the schedule they are measured
 * against, and the correction requests that change a locked week.
 *
 * The API is the only contract — the web app imports these shapes as `@beacon/shared`
 * and never redeclares them. The arithmetic lives here too, because the browser prints
 * a running total for the current day while the server prints the same total for the
 * week: two implementations would disagree by a rounding rule sooner or later.
 */

/**
 * The clock state, shared so the sidebar, the Today screen and the API agree.
 *
 * Break is a state of its own, not a gap between two entries: the control offers
 * different actions in each state (`in` → clock out / start break; `break` → resume /
 * clock out; `out` → clock in / add a manual entry) and only a *running* state pulses.
 */
export const CLOCK_STATES = ['in', 'break', 'out'] as const;

export type ClockState = (typeof CLOCK_STATES)[number];

/** Whether the state is running, and so whether the status dot pulses. */
export function isRunning(state: ClockState): boolean {
  return state !== 'out';
}

/**
 * Where an entry came from. The design labels a segment "Office · badge", so the
 * origin is displayed, not just audited — and the desktop client will write
 * `desktop` against the same column when it lands.
 */
export const ATTENDANCE_SOURCES = ['manual', 'web', 'mobile', 'desktop', 'badge'] as const;

export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/**
 * Whether a stretch of time is counted. An entry created by the clock is `approved`
 * on the spot; one that arrives through a correction waits for its approver.
 */
export const APPROVAL_STATUSES = ['approved', 'pending', 'rejected'] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * How a person's hours are meant to be worked. The model changes what the schedule
 * carries, not how minutes are counted: `flextime` has core hours, `fixed` a start and
 * an end, `trust` nothing at all, and `shift` points at a roster.
 */
export const WORK_MODELS = ['flextime', 'fixed', 'trust', 'shift'] as const;

export type WorkModel = (typeof WORK_MODELS)[number];

/**
 * Monday-first, matching the calendar grid and `Date.getUTCDay()` shifted by one.
 * The index into `expectedMinutes` is this array's index, so part-time patterns like
 * "Mon–Thu only" are expressible without a second entity.
 */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Minutes in an hour and in a day, named so the arithmetic below reads. */
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * The weekly hours the design's slider offers: 10–40 h in 2.5 h steps. Part-time is
 * the normal case here, not an edge case, so the bounds are shared rather than
 * hard-coded into the settings screen.
 */
export const WEEKLY_MINUTES_MIN = 10 * MINUTES_PER_HOUR;
export const WEEKLY_MINUTES_MAX = 40 * MINUTES_PER_HOUR;
export const WEEKLY_MINUTES_STEP = 150;

/** The default overtime cap, in minutes — the design's `Cap 40:00`. */
export const DEFAULT_OVERTIME_CAP_MINUTES = 40 * MINUTES_PER_HOUR;

/** One stretch of time on the timeline: either worked time or a break inside it. */
export interface AttendanceSegment {
  id: string;
  kind: 'work' | 'break';
  /** ISO 8601 instant in UTC; the client converts using the user's own zone. */
  startedAt: string;
  /** Null while the segment is still running. */
  endedAt: string | null;
  source: AttendanceSource;
  note: string | null;
  approvalStatus: ApprovalStatus;
  /** Null while running — a live segment is timed from `startedAt` in the browser. */
  durationMinutes: number | null;
}

/** The schedule a day is measured against, as the Profile and Today screens show it. */
export interface WorkScheduleSummary {
  id: string;
  model: WorkModel;
  weeklyMinutes: number;
  /** One entry per {@link WEEKDAYS} index. Stored, never divided on the fly. */
  expectedMinutes: number[];
  /** `flextime` only — `10:00` / `15:00` as local wall-clock times. */
  coreStart: string | null;
  coreEnd: string | null;
  /** `fixed` only. */
  startTime: string | null;
  endTime: string | null;
  /** `shift` only — the roster this person is drawn from. */
  rosterRef: string | null;
  /** Effective-dated: a contract change adds a row rather than editing history. */
  effectiveFrom: string;
}

/**
 * The running balance and its cap.
 *
 * Accruing past the cap is deliberate: minutes that were genuinely worked are never
 * dropped from the record, so `balanceMinutes` keeps climbing and `overCapMinutes`
 * says by how much. The cap is a signal for a manager to act, not a shredder.
 */
export interface OvertimeSummary {
  balanceMinutes: number;
  capMinutes: number;
  overCap: boolean;
  /** How far past the cap the balance stands; `0` while inside it. */
  overCapMinutes: number;
}

/** `GET /attendance/me/today`. */
export interface TodayStatus {
  /** The user's own zone, resolved server-side, so the day boundary is unambiguous. */
  timezone: string;
  /** The local date the segments below belong to, as `YYYY-MM-DD`. */
  date: string;
  state: ClockState;
  /**
   * When the *current* state began, or null when clocked out. The browser ticks from
   * this instant rather than from a counter of its own — a sleeping laptop stops
   * firing timers, and a self-incrementing count would wake up hours short.
   */
  since: string | null;
  segments: AttendanceSegment[];
  workedMinutes: number;
  breakMinutes: number;
  targetMinutes: number;
}

/** One row of the timesheet table. */
export interface TimesheetDay {
  /** `YYYY-MM-DD` in the user's zone. */
  date: string;
  weekday: Weekday;
  /** First clock-in and last clock-out of the day, or null on an empty day. */
  startedAt: string | null;
  endedAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  targetMinutes: number;
  /**
   * Worked minus target, except on a credited day. Absence is credited at target —
   * never counted as worked time — so a full day off reads `0:00`, not `-8:00`.
   */
  balanceMinutes: number;
  /**
   * The absence type covering this day, if any. A day may carry both a tag and real
   * hours: home office is a working day that still appears on the calendar.
   */
  absenceTag: string | null;
  /** Whether the target was met by an absence rather than by worked time. */
  credited: boolean;
  /**
   * The public holiday's name, if this day is one — `targetMinutes` is then `0` and
   * any hours worked read as pure overtime, the same rule the attendance report uses.
   */
  holiday: string | null;
  hasPendingCorrection: boolean;
}

/** `GET /attendance/me/week`. */
export interface TimesheetWeek {
  /** Monday and Sunday of the week, `YYYY-MM-DD` in the user's zone. */
  from: string;
  to: string;
  /** 0 for the current week, -1 for the one before it. */
  offset: number;
  timezone: string;
  days: TimesheetDay[];
  workedMinutes: number;
  breakMinutes: number;
  targetMinutes: number;
  balanceMinutes: number;
  overtime: OvertimeSummary;
  /** Once locked, a change needs a correction request rather than an edit. */
  locked: boolean;
  /** The instant the week locks, so the notice can name it. */
  locksAt: string;
}

export interface ClockRequest {
  /** Defaults to `web`. The desktop and mobile clients name themselves. */
  source?: AttendanceSource;
  note?: string | null;
}

/**
 * Stopping the clock, optionally at an instant that has already passed.
 *
 * The web app never sends `at` — it is clocking out now, and the server's own clock is
 * the more trustworthy of the two. The desktop client does: a machine going into
 * standby may sleep before its request lands, so the clock-out is recorded locally
 * first and replayed on resume, naming the instant the machine actually went away.
 * Without that, an entry would either stay open or bank the whole sleep as work.
 *
 * The server still bounds it: never in the future, never before the entry started.
 */
export interface ClockOutRequest {
  /** An ISO-8601 instant. Defaults to now. */
  at?: string;
}

/**
 * How far a client's clock may run ahead of the server's before a backdated clock-out
 * is refused. Machines drift and NTP corrects in steps; a minute absorbs that without
 * letting a client bank time it has not worked yet.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

export const CORRECTION_KINDS = ['add', 'amend', 'remove'] as const;

export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export interface CorrectionSummary {
  id: string;
  kind: CorrectionKind;
  /** The entry being amended or removed; null when one is being added. */
  entryId: string | null;
  requestedById: string;
  requestedByName: string;
  /** The manager it routes to — `User.manager`, the same edge absence uses. */
  approverId: string | null;
  approverName: string | null;
  /** `YYYY-MM-DD` in the requester's zone, so a queue can group by day. */
  date: string;
  /** The times being asked for; null on a removal. */
  startedAt: string | null;
  endedAt: string | null;
  breakMinutes: number;
  reason: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface CreateCorrectionRequest {
  kind: CorrectionKind;
  entryId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  breakMinutes?: number;
  reason: string;
}

export interface DecideCorrectionRequest {
  note?: string | null;
}

/**
 * Minutes between two instants, rounded to the nearest minute.
 *
 * Rounding once here — rather than summing raw milliseconds and rounding the total —
 * is what keeps a day's segments adding up to the day total the server printed.
 */
export function minutesBetween(startedAt: Date | string, endedAt: Date | string): number {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  const end = typeof endedAt === 'string' ? new Date(endedAt) : endedAt;

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/**
 * Worked and break totals for a set of segments, counting a still-running segment up
 * to `now`. Breaks are subtracted from work: the break clock runs *inside* an entry,
 * so its minutes would otherwise be counted twice.
 */
export function totalsOf(
  segments: readonly AttendanceSegment[],
  now: Date = new Date(),
): { workedMinutes: number; breakMinutes: number } {
  let worked = 0;
  let breaks = 0;

  for (const segment of segments) {
    const minutes = segment.endedAt
      ? (segment.durationMinutes ?? minutesBetween(segment.startedAt, segment.endedAt))
      : minutesBetween(segment.startedAt, now);

    if (segment.kind === 'break') breaks += minutes;
    else worked += minutes;
  }

  return { workedMinutes: Math.max(0, worked - breaks), breakMinutes: breaks };
}

/** The expected minutes for one weekday under a schedule. */
export function targetMinutesFor(schedule: WorkScheduleSummary, weekday: Weekday): number {
  return schedule.expectedMinutes[WEEKDAYS.indexOf(weekday)] ?? 0;
}

/**
 * An even five-day split of a weekly figure, weekends at zero. Only the *default* a
 * new schedule starts from — the per-weekday minutes are stored, so an organization
 * that works four long days keeps them.
 */
export function defaultExpectedMinutes(weeklyMinutes: number): number[] {
  const perDay = Math.round(weeklyMinutes / 5);

  return WEEKDAYS.map((_, index) => (index < 5 ? perDay : 0));
}

/** The cap read of a raw balance. See {@link OvertimeSummary} for why it accrues. */
export function summarizeOvertime(
  balanceMinutes: number,
  capMinutes: number = DEFAULT_OVERTIME_CAP_MINUTES,
): OvertimeSummary {
  const overCapMinutes = Math.max(0, balanceMinutes - capMinutes);

  return { balanceMinutes, capMinutes, overCap: overCapMinutes > 0, overCapMinutes };
}

/**
 * How far through the day's target the person is, 0–1. Used for the progress bar on
 * Today, which stops at full rather than overflowing its track.
 */
export function dayProgress(workedMinutes: number, targetMinutes: number): number {
  if (targetMinutes <= 0) return workedMinutes > 0 ? 1 : 0;

  return Math.min(1, Math.max(0, workedMinutes / targetMinutes));
}

/** The weekday of a `YYYY-MM-DD` date, Monday-first. */
export function weekdayOf(date: string): Weekday {
  // Parsed as UTC deliberately: the string is already a local calendar date, and
  // letting the host zone reinterpret it would shift a day either side of midnight.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  return WEEKDAYS[(day + 6) % 7];
}

/** Monday of the week containing `date`, as `YYYY-MM-DD`. */
export function startOfWeek(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - WEEKDAYS.indexOf(weekdayOf(date)));

  return at.toISOString().slice(0, 10);
}

/** `date` shifted by whole days, staying a `YYYY-MM-DD` string. */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);

  return at.toISOString().slice(0, 10);
}

/** The seven dates of the week starting at `monday`. */
export function weekDates(monday: string): string[] {
  return WEEKDAYS.map((_, index) => addDays(monday, index));
}

/**
 * The day balance. An absence is *credited*: the day counts toward the week's target
 * but its minutes are never worked time, so the balance reads zero rather than a full
 * day of overtime — while a home-office day with real hours balances normally.
 */
export function dayBalance(
  workedMinutes: number,
  targetMinutes: number,
  credited: boolean,
): number {
  return credited ? Math.max(0, workedMinutes - targetMinutes) : workedMinutes - targetMinutes;
}

/**
 * Whether a week is still editable, and when it stops being.
 *
 * The design's notice reads "Week is unlocked until Monday 09:00" — the grace window
 * runs past the end of the week so Friday evening can still be tidied up on Monday
 * morning. After that a change is a correction request, not an edit.
 */
export const WEEK_LOCK_GRACE_MINUTES = 7 * MINUTES_PER_DAY + 9 * MINUTES_PER_HOUR;

/**
 * The instant the week starting at `monday` locks.
 *
 * `offsetMinutes` is the user's offset from UTC — 09:00 must be nine in the morning
 * where the person works, not in UTC, or the notice is off by a whole timezone. The
 * API resolves it from `User.timezone`; the browser passes its own.
 */
export function weekLocksAt(monday: string, offsetMinutes = 0): Date {
  const base = new Date(`${monday}T00:00:00Z`).getTime();

  return new Date(base + (WEEK_LOCK_GRACE_MINUTES - offsetMinutes) * 60_000);
}

export function isWeekLocked(monday: string, now: Date = new Date(), offsetMinutes = 0): boolean {
  return now.getTime() >= weekLocksAt(monday, offsetMinutes).getTime();
}
