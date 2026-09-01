/**
 * Timezone display for the page header — `Friday, 28 August 2026` and `Berlin · CEST`.
 *
 * The header states the user's own timezone from the very first screen, because
 * every instant in Beacon is stored in UTC and converted at the edge: a clock-in at
 * 09:12 means nothing without saying whose 09:12 it was. Phase 1 adds `User.timezone`
 * and the office; until then {@link resolveTimezone} falls back to the browser's.
 */

/** The browser's IANA zone, or UTC where `Intl` cannot say (non-browser test runs). */
function browserTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

/** The user's zone when we know it, the browser's otherwise. */
export function resolveTimezone(preferred?: string | null): string {
	return preferred?.trim() || browserTimezone();
}

/**
 * The city half of an IANA zone: `Europe/Berlin` → `Berlin`, `America/New_York` →
 * `New York`. Zones without a region (`UTC`) are their own label.
 */
export function timezoneCity(timezone: string): string {
	const segments = timezone.split('/');
	return (segments.at(-1) ?? timezone).replace(/_/g, ' ');
}

/**
 * ICU long names whose initials are not the abbreviation people use.
 *
 * The *Summer* variants initial correctly (`Central European Summer Time` → `CEST`),
 * but their *Standard* counterparts do not — Europe drops the word entirely, where
 * North America keeps it (`Pacific Standard Time` really is `PST`). Rather than guess,
 * name the exceptions.
 */
const ABBREVIATIONS: Record<string, string> = {
	'Central European Standard Time': 'CET',
	'Eastern European Standard Time': 'EET',
	'Western European Standard Time': 'WET',
	'West Africa Standard Time': 'WAT',
	'Moscow Standard Time': 'MSK'
};

/**
 * The zone's abbreviation for the given instant — `CEST` in summer, `CET` in winter,
 * `MESZ` in German.
 *
 * `timeZoneName: 'short'` is the abbreviation where the locale has one, but for many
 * zones English only offers a numeric offset (`GMT+2`). There we work from the long
 * name instead: the exception table first, then its initials (*Japan Standard Time*
 * → `JST`). The offset is still the answer for a zone with no name at all, which is
 * why it is the last resort.
 */
export function timezoneAbbreviation(timezone: string, locale: string, at: Date): string {
	const short = timezoneName(timezone, locale, at, 'short');
	if (!/^(GMT|UTC)[+-]/.test(short)) return short;

	const long = timezoneName(timezone, locale, at, 'long');
	const initials = ABBREVIATIONS[long] ?? long.match(/\b\p{Lu}/gu)?.join('') ?? '';
	// Two letters is not an abbreviation anyone recognises — keep the offset.
	return initials.length >= 3 ? initials : short;
}

function timezoneName(
	timeZone: string,
	locale: string,
	at: Date,
	timeZoneName: 'short' | 'long'
): string {
	try {
		const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName }).formatToParts(at);
		return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
	} catch {
		return timeZone;
	}
}

/** `Berlin · CEST` — the right-hand half of the page header. */
export function timezoneLabel(timezone: string, locale: string, at: Date = new Date()): string {
	return `${timezoneCity(timezone)} · ${timezoneAbbreviation(timezone, locale, at)}`;
}

/** `Friday, 28 August 2026`, in the user's locale and zone. */
export function formatHeaderDate(at: Date, timezone: string, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, {
			timeZone: timezone,
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(at);
	} catch {
		return at.toISOString().slice(0, 10);
	}
}

/** A region of the IANA database and the zones under it, ready for an `<optgroup>`. */
export interface TimezoneGroup {
	/** The first segment of the id — `Europe`, `America` — or `Other` for `UTC`. */
	region: string;
	zones: { value: string; label: string }[];
}

/** Zones with no region of their own (`UTC`) are collected under this heading. */
const OTHER_REGION = 'Other';

/**
 * Every zone the runtime knows, grouped by region, with `current` guaranteed to be
 * among them.
 *
 * The picker exists so a zone cannot be mistyped: `Europe/Berlon` used to save
 * cleanly and then quietly misplace every clock-in, exactly as a typo'd locale
 * used to. `Intl.supportedValuesOf` is the same list the formatter will accept,
 * which is why it — and not a hand-kept table — is the source. Where it is missing
 * the list collapses to what we can still name; a stored value is always added
 * back, so opening the form can never rewrite a zone nobody touched.
 */
export function timezoneGroups(current?: string | null): TimezoneGroup[] {
	// `UTC` is added by hand: it is a zone every runtime formats against and the one
	// a fresh organization starts on, yet some ICU builds leave it out of the
	// enumeration — and a picker missing the saved value silently reassigns it.
	const zones = new Set(['UTC', ...supportedTimezones()]);
	const saved = current?.trim();
	if (saved) zones.add(saved);

	const groups = new Map<string, { value: string; label: string }[]>();
	for (const zone of zones) {
		const [head, ...rest] = zone.split('/');
		const region = rest.length ? head : OTHER_REGION;
		const label = rest.length ? rest.join(' / ').replace(/_/g, ' ') : zone;
		const group = groups.get(region) ?? [];
		group.push({ value: zone, label });
		groups.set(region, group);
	}

	return [...groups.entries()]
		.map(([region, list]) => ({
			region,
			zones: list.sort((left, right) => left.label.localeCompare(right.label))
		}))
		.sort(byRegion);
}

/** Alphabetical, except `Other` — a leftovers bucket rather than a region — last. */
function byRegion(left: TimezoneGroup, right: TimezoneGroup): number {
	if (left.region === OTHER_REGION) return right.region === OTHER_REGION ? 0 : 1;
	if (right.region === OTHER_REGION) return -1;

	return left.region.localeCompare(right.region);
}

function supportedTimezones(): string[] {
	try {
		return Intl.supportedValuesOf('timeZone');
	} catch {
		return [browserTimezone(), 'UTC'];
	}
}
