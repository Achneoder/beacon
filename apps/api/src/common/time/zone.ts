/**
 * Timezone arithmetic for the API edge.
 *
 * Every instant is stored as `timestamptz` in UTC; a *day* is not an instant, so
 * "today" and "this week" only mean something once a zone is applied. These two
 * helpers are the only place that conversion happens server-side.
 *
 * `Intl` is used rather than a date library because Node ships the full tz database:
 * offsets follow DST automatically, and a fixed offset would drift twice a year.
 */

/** Falls back through the organization to UTC, so a zone is always resolvable. */
export function resolveTimezone(userZone: string | null, organizationZone: string): string {
  const zone = userZone ?? organizationZone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    // A zone the runtime does not know would otherwise throw on every request.
    return 'UTC';
  }
}

/** The local calendar date at `at`, as `YYYY-MM-DD`. */
export function localDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The zone's offset from UTC in minutes at `at` — positive east of Greenwich, so
 * Berlin in summer is `120`. Derived by formatting the instant as if it were UTC and
 * measuring the gap, which is exact for every zone `Intl` knows.
 */
export function offsetMinutes(timezone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // `formatToParts` renders midnight as hour 24; Date.UTC handles the roll-over.
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );

  return Math.round((asUtc - at.getTime()) / 60_000);
}
