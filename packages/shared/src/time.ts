/**
 * Time formatting, shared by the API, the web app and the future clients.
 *
 * The design draws two distinct shapes and mixes them nowhere: a *duration* is
 * `H:MM` (worked time, balances, targets) and the *live day clock* is `HH:MM:SS`.
 * Both are rendered in the mono face. Keeping the formatters here means a total
 * computed on the server and a counter ticking in the browser never disagree.
 *
 * Every function takes a plain number so it stays pure and locale-independent —
 * these are digit groupings, not localized text.
 */

/** Minutes in an hour, and seconds in a minute — named so the arithmetic reads. */
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * A duration in minutes as `H:MM` — `0:00`, `7:35`, `41:15`. Hours are not padded,
 * because the design writes `6:00`, never `06:00`. The sign is dropped; use
 * {@link formatSignedDuration} where direction matters.
 */
export function formatDuration(minutes: number): string {
  const total = Math.abs(Math.round(minutes));
  return `${Math.floor(total / MINUTES_PER_HOUR)}:${pad(total % MINUTES_PER_HOUR)}`;
}

/**
 * A balance as `+1:45` / `-0:20` / `0:00`. Zero carries no sign — an exactly-met
 * target is neither over nor under.
 */
export function formatSignedDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${formatDuration(rounded)}`;
}

/**
 * A running count of seconds as `HH:MM:SS`, for the live clock only. Hours are
 * padded here — a ticking readout that changes width jitters.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / (MINUTES_PER_HOUR * SECONDS_PER_MINUTE));
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  return `${pad(hours)}:${pad(minutes)}:${pad(total % SECONDS_PER_MINUTE)}`;
}

/**
 * Whole seconds between an instant and now.
 *
 * The clock is always driven from a server-supplied `startedAt` rather than a
 * client-side accumulator: a sleeping laptop stops firing timers, and a counter
 * that increments itself would silently under-report the day.
 */
export function secondsSince(startedAt: Date | string, now: Date = new Date()): number {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));
}
