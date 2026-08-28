/**
 * Absence: the types an organization offers, the requests employees raise against
 * them, the yearly quota those requests spend, and the public holidays that are not
 * spent at all.
 *
 * The working-day arithmetic lives here rather than in the API because the calendar
 * prints the cost of a selection — `5 days · Vacation` — before anything is sent.
 * Two implementations of "how many days is that" would disagree over a bank holiday
 * eventually, and the one on screen is the one the employee believes.
 */

/**
 * The palette role a type is drawn in. A role rather than a hex value: the tokens in
 * `apps/web/src/lib/styles/tokens.css` already carry both themes, and a stored colour
 * would go unreadable the first time someone switches to dark.
 */
export const ABSENCE_COLOR_ROLES = ['accent', 'warning', 'success', 'info', 'muted'] as const;

export type AbsenceColorRole = (typeof ABSENCE_COLOR_ROLES)[number];

/**
 * Four states, not three. The design draws an approved absence in the future
 * differently from one already counted against the year — `taken` is what a day
 * becomes once it has been lived, and it is what stops a withdrawal.
 */
export const ABSENCE_STATUSES = ['pending', 'approved', 'rejected', 'taken'] as const;

export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

/** Whether the request still holds days against the quota. Rejected ones never did. */
export function isCommitted(status: AbsenceStatus): boolean {
  return status === 'approved' || status === 'taken';
}

/**
 * The eight types every new organization starts with.
 *
 * The three flags are genuinely independent, which is why they are three: home
 * office, training and a business trip are *working* days — they show on the calendar
 * and tag a timesheet row, but they cost no quota and credit no target, because the
 * hours are really worked. Vacation is the only type that spends the quota; unpaid
 * leave is the only one that is neither paid nor worked.
 */
export interface AbsenceTypeSeed {
  key: string;
  name: string;
  deductsFromQuota: boolean;
  paid: boolean;
  countsAsWork: boolean;
  colorRole: AbsenceColorRole;
}

export const DEFAULT_ABSENCE_TYPES: readonly AbsenceTypeSeed[] = [
  { key: 'vacation', name: 'Vacation', deductsFromQuota: true, paid: true, countsAsWork: false, colorRole: 'accent' },
  { key: 'sick', name: 'Sick leave', deductsFromQuota: false, paid: true, countsAsWork: false, colorRole: 'warning' },
  { key: 'home-office', name: 'Home office', deductsFromQuota: false, paid: true, countsAsWork: true, colorRole: 'info' },
  { key: 'unpaid', name: 'Unpaid leave', deductsFromQuota: false, paid: false, countsAsWork: false, colorRole: 'muted' },
  { key: 'parental', name: 'Parental leave', deductsFromQuota: false, paid: false, countsAsWork: false, colorRole: 'muted' },
  { key: 'training', name: 'Training', deductsFromQuota: false, paid: true, countsAsWork: true, colorRole: 'success' },
  { key: 'business-trip', name: 'Business trip', deductsFromQuota: false, paid: true, countsAsWork: true, colorRole: 'success' },
  { key: 'special', name: 'Special leave', deductsFromQuota: false, paid: true, countsAsWork: false, colorRole: 'info' },
] as const;

export interface AbsenceTypeSummary {
  id: string;
  key: string;
  name: string;
  deductsFromQuota: boolean;
  paid: boolean;
  /** Home office, training, a business trip — on the calendar, but still worked. */
  countsAsWork: boolean;
  colorRole: AbsenceColorRole;
  active: boolean;
  position: number;
}

export interface AbsenceRequestSummary {
  id: string;
  userId: string;
  userName: string;
  typeId: string;
  typeKey: string;
  typeName: string;
  colorRole: AbsenceColorRole;
  countsAsWork: boolean;
  /** Inclusive, `YYYY-MM-DD` in the requester's zone. */
  startsOn: string;
  endsOn: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  status: AbsenceStatus;
  /** What the request costs the quota; `0` for a type that does not deduct. */
  costDays: number;
  /** Working days covered, whether or not they are charged. */
  workingDays: number;
  approverId: string | null;
  approverName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  note: string | null;
  /** The sick note, once documents exist — phase 4 fills this in. */
  documentId: string | null;
  createdAt: string;
}

export interface CreateAbsenceRequest {
  typeId: string;
  startsOn: string;
  endsOn: string;
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
  note?: string | null;
  /** Raising an absence for someone else needs `holiday:approve`. */
  userId?: string | null;
}

export interface DecideAbsenceRequest {
  note?: string | null;
}

/**
 * A year's quota. `takenDays` counts every committed day — approved and taken alike —
 * because an approved week in December is spent the moment it is granted, not the
 * moment it arrives.
 */
export interface LeaveBalanceSummary {
  year: number;
  entitlementDays: number;
  carryOverDays: number;
  /** Carry-over is use-it-or-lose-it; `null` means it never expires. */
  carryOverExpiresOn: string | null;
  takenDays: number;
  /** Days sitting in requests nobody has decided yet. */
  pendingDays: number;
  /** Entitlement plus surviving carry-over, less what is committed. */
  remainingDays: number;
}

export interface HolidaySummary {
  id: string;
  date: string;
  name: string;
  /** A state or canton; `null` is the whole organization. */
  region: string | null;
}

/** One cell of the month grid. */
export interface CalendarDay {
  date: string;
  weekend: boolean;
  holiday: string | null;
  /** Every absence touching the day — a team calendar shows more than one. */
  absences: AbsenceRequestSummary[];
}

/** `GET /absences/calendar`. */
export interface AbsenceCalendar {
  from: string;
  to: string;
  timezone: string;
  days: CalendarDay[];
  holidays: HolidaySummary[];
}

/** Saturday and Sunday. Parsed as UTC so the host zone cannot shift the day. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  return day === 0 || day === 6;
}

/** Every date from `from` to `to`, inclusive. Empty when the range runs backwards. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  const at = new Date(`${from}T00:00:00Z`);

  while (at.getTime() <= end) {
    dates.push(at.toISOString().slice(0, 10));
    at.setUTCDate(at.getUTCDate() + 1);
  }

  return dates;
}

/** The dates in a range that are actually worked: no weekends, no public holidays. */
export function workingDaysBetween(
  from: string,
  to: string,
  holidays: Iterable<string> = [],
): string[] {
  const closed = new Set(holidays);

  return datesBetween(from, to).filter((date) => !isWeekend(date) && !closed.has(date));
}

export interface AbsenceCostInput {
  startsOn: string;
  endsOn: string;
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
}

/**
 * What a selection costs, in days.
 *
 * A half day only discounts a boundary that is itself a working day — marking the
 * Saturday of a Sat–Sun request as a half day must not turn a zero-day range into a
 * negative one. A single-day request flagged at both ends is still half a day, not
 * zero: the two flags name the same morning and afternoon.
 */
export function absenceCostDays(
  request: AbsenceCostInput,
  holidays: Iterable<string> = [],
): number {
  const days = workingDaysBetween(request.startsOn, request.endsOn, holidays);
  if (days.length === 0) return 0;

  const firstIsHalf = Boolean(request.halfDayStart) && days[0] === request.startsOn;
  const lastIsHalf = Boolean(request.halfDayEnd) && days[days.length - 1] === request.endsOn;

  // On a one-day request both flags name the same morning and afternoon, so the
  // discount applies once — subtracting twice would make half a day cost nothing.
  const halves = days.length === 1 ? Number(firstIsHalf || lastIsHalf) : Number(firstIsHalf) + Number(lastIsHalf);

  return Math.max(0, days.length - halves * 0.5);
}

/**
 * The cost split by calendar year, for a request that crosses New Year.
 *
 * Quotas are yearly, so a 28 December – 3 January holiday spends two of them. Charging
 * the whole thing to the year it started in is the bug this exists to prevent.
 */
export function absenceCostByYear(
  request: AbsenceCostInput,
  holidays: Iterable<string> = [],
): Map<number, number> {
  const closed = [...holidays];
  const years = new Map<number, number>();

  for (const year of yearsSpanned(request.startsOn, request.endsOn)) {
    const from = maxDate(request.startsOn, `${year}-01-01`);
    const to = minDate(request.endsOn, `${year}-12-31`);
    const cost = absenceCostDays(
      {
        startsOn: from,
        endsOn: to,
        halfDayStart: request.halfDayStart && from === request.startsOn,
        halfDayEnd: request.halfDayEnd && to === request.endsOn,
      },
      closed,
    );

    if (cost > 0) years.set(year, cost);
  }

  return years;
}

function yearsSpanned(from: string, to: string): number[] {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  const years: number[] = [];

  for (let year = first; year <= last; year += 1) years.push(year);

  return years;
}

function maxDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

/**
 * The days still available, honouring carry-over expiry.
 *
 * Carry-over is use-it-or-lose-it: past `carryOverExpiresOn` it stops counting, so a
 * balance read in April is smaller than the same row read in February. `on` is a
 * local date, and the expiry day itself still counts.
 */
export function remainingLeaveDays(
  balance: Pick<
    LeaveBalanceSummary,
    'entitlementDays' | 'carryOverDays' | 'carryOverExpiresOn' | 'takenDays'
  >,
  on: string,
): number {
  const expired = balance.carryOverExpiresOn !== null && on > balance.carryOverExpiresOn;
  const carried = expired ? 0 : balance.carryOverDays;

  return round(balance.entitlementDays + carried - balance.takenDays);
}

/** Half days are the only fraction, so two decimals of slack is plenty. */
function round(days: number): number {
  return Math.round(days * 100) / 100;
}

/**
 * A day count as the calendar prints it — `5`, `0.5`, `2.5`. Whole days carry no
 * decimal; the unit is added by the caller, because it is translated.
 */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

/**
 * Whether two ranges touch. Used to refuse a second absence over days already
 * spoken for — a sick day inside an approved holiday is a correction, not a request.
 */
export function rangesOverlap(
  left: { startsOn: string; endsOn: string },
  right: { startsOn: string; endsOn: string },
): boolean {
  return left.startsOn <= right.endsOn && right.startsOn <= left.endsOn;
}

/**
 * The absence covering a given day, if any, once the calendar is flattened.
 *
 * A day may carry both a tag and real hours — home office is a working day — so the
 * timesheet asks for the tag and separately asks whether the day is *credited*:
 * credited means the target was met by the absence rather than by worked time, which
 * is exactly `!countsAsWork`.
 */
export function creditsTarget(type: Pick<AbsenceTypeSummary, 'countsAsWork'>): boolean {
  return !type.countsAsWork;
}
