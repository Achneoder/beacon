import type { ApprovalStatus, AttendanceSource, ClockState, Weekday } from '@beacon/shared';
import type { Tone } from '$lib/components/ui/types';

/**
 * Enum values map to translation keys, never to English strings. Instants are
 * formatted in the *user's* zone, which the API states on every response — the
 * browser's own zone is only a fallback for a session that has not loaded yet.
 */

/** `09:12` — a wall-clock time of day, always 24-hour and always mono on screen. */
export function formatTimeOfDay(
	instant: string | null,
	timezone: string,
	locale: string
): string | null {
	if (!instant) return null;

	try {
		return new Intl.DateTimeFormat(locale, {
			timeZone: timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(instant));
	} catch {
		return instant.slice(11, 16);
	}
}

/** `09:12 – 12:45`, or `09:12 – …` while the segment is still running. */
export function formatTimeRange(
	startedAt: string,
	endedAt: string | null,
	timezone: string,
	locale: string,
	openLabel: string
): string {
	const start = formatTimeOfDay(startedAt, timezone, locale) ?? '';
	const end = formatTimeOfDay(endedAt, timezone, locale) ?? openLabel;

	return `${start} – ${end}`;
}

export function sourceKey(source: AttendanceSource): string {
	return `attendance.source.${source}`;
}

export function weekdayKey(weekday: Weekday): string {
	return `attendance.weekday.${weekday}`;
}

export function clockStateKey(state: ClockState): string {
	return `shell.status.${state}`;
}

export function approvalKey(status: ApprovalStatus): string {
	return `attendance.approval.${status}`;
}

/** Pending is a question, rejected is a problem, approved is unremarkable. */
export function approvalTone(status: ApprovalStatus): Tone {
	switch (status) {
		case 'approved':
			return 'success';
		case 'pending':
			return 'warning';
		default:
			return 'neutral';
	}
}

/**
 * How a balance reads: over is good, under is not, and exactly on target is neither.
 * The threshold is a whole minute, so a rounding artefact does not colour a row.
 */
export function balanceTone(minutes: number): Tone {
	if (minutes > 0) return 'success';
	if (minutes < 0) return 'warning';

	return 'neutral';
}

/** `YYYY-MM-DD` as a short label for a timesheet row — `26 Aug`. */
export function formatDayLabel(date: string, locale: string): string {
	const at = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(at.getTime())) return date;

	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	}).format(at);
}

/** `Monday 09:00` — when the current week stops being editable. */
export function formatLockMoment(instant: string, timezone: string, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, {
			timeZone: timezone,
			weekday: 'long',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(instant));
	} catch {
		return instant;
	}
}
