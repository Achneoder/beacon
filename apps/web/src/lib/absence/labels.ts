import type { AbsenceColorRole, AbsenceStatus, AbsenceTypeSummary } from '@beacon/shared';
import type { Tone } from '$lib/components/ui/types';

/**
 * Absence display rules. Enum values map to translation keys, never to English
 * strings, and colours map to palette *roles* — the tokens carry both themes, so a
 * type tinted `accent` stays legible when the user switches to dark.
 */

/**
 * The tone a type is drawn in. `muted` has no counterpart in the UI palette, which
 * only names semantic roles — it is the absence of emphasis, so it reads `neutral`.
 */
export function toneOf(role: AbsenceColorRole): Tone {
	return role === 'muted' ? 'neutral' : role;
}

/** The tint a calendar cell carries. Soft backgrounds, so the date stays readable. */
const CELL_TINTS: Record<AbsenceColorRole, string> = {
	accent: 'bg-accent-soft text-accent-on-soft',
	warning: 'bg-warning-soft text-warning',
	success: 'bg-success-soft text-success',
	info: 'bg-info-soft text-info',
	muted: 'bg-border-subtle text-ink-muted'
};

export function cellTint(role: AbsenceColorRole): string {
	return CELL_TINTS[role];
}

/**
 * A type's name.
 *
 * Types are per-organization and renameable, so the stored name is the source of
 * truth — but the eight seeded ones ship in English and must read German too. The
 * key wins where a translation exists; anything an organization adds falls back to
 * whatever it called it.
 */
export function typeNameKey(type: Pick<AbsenceTypeSummary, 'key'>): string {
	return `absence.type.${type.key}`;
}

export function typeName(
	type: Pick<AbsenceTypeSummary, 'key' | 'name'>,
	translate: (key: string) => string
): string {
	const key = typeNameKey(type);
	const translated = translate(key);

	return translated === key ? type.name : translated;
}

export function statusKey(status: AbsenceStatus): string {
	return `absence.status.${status}`;
}

/**
 * Pending is a question, taken is history, approved is settled and good. Rejected is
 * neutral rather than alarming — a refusal is an answer, not a fault.
 */
export function statusTone(status: AbsenceStatus): Tone {
	switch (status) {
		case 'approved':
			return 'success';
		case 'pending':
			return 'warning';
		case 'taken':
			return 'info';
		default:
			return 'neutral';
	}
}

/** `August 2026` — the calendar's month heading. */
export function formatMonth(month: string, locale: string): string {
	const at = new Date(`${month}-01T00:00:00Z`);
	if (Number.isNaN(at.getTime())) return month;

	return new Intl.DateTimeFormat(locale, {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(at);
}

/** `26 Aug 2026` — a request's dates, spelled out. */
export function formatDate(date: string, locale: string): string {
	const at = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(at.getTime())) return date;

	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(at);
}

/** `24 – 28 Aug 2026`, collapsing to one date when the range is a single day. */
export function formatRange(startsOn: string, endsOn: string, locale: string): string {
	return startsOn === endsOn
		? formatDate(startsOn, locale)
		: `${formatDate(startsOn, locale)} – ${formatDate(endsOn, locale)}`;
}

/** `YYYY-MM` of the month containing `date`. */
export function monthOf(date: string): string {
	return date.slice(0, 7);
}

/** The month `count` months away from `YYYY-MM`. */
export function shiftMonth(month: string, count: number): string {
	const at = new Date(`${month}-01T00:00:00Z`);
	at.setUTCMonth(at.getUTCMonth() + count);

	return at.toISOString().slice(0, 7);
}

/**
 * The six-row grid a month is drawn on: the Monday on or before the first, through
 * to the Sunday that completes the sixth week.
 *
 * Always six rows, never five: a grid that changes height as you page months makes
 * the panel below it jump.
 */
export function gridRange(month: string): { from: string; to: string } {
	const first = new Date(`${month}-01T00:00:00Z`);
	const lead = (first.getUTCDay() + 6) % 7;

	const from = new Date(first);
	from.setUTCDate(from.getUTCDate() - lead);

	const to = new Date(from);
	to.setUTCDate(to.getUTCDate() + 41);

	return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
