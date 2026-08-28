import type { ContractType, UserStatusValue, WorkLocation } from '@beacon/shared';
import type { Tone } from '$lib/components/ui/types';

/**
 * Enum values map to translation keys, never to English strings — the Profile screen
 * prints "Permanent · Full-time" in `en` and "Unbefristet · Vollzeit" in `de` from the
 * same stored value.
 */
export function contractKey(contract: ContractType | null): string | null {
	return contract ? `people.contract.${contract}` : null;
}

export function workLocationKey(location: WorkLocation | null): string | null {
	return location ? `people.workLocation.${location}` : null;
}

export function statusKey(status: UserStatusValue): string {
	return `people.status.${status}`;
}

/** How a status pill reads: active is unremarkable, disabled is a warning. */
export function statusTone(status: UserStatusValue): Tone {
	switch (status) {
		case 'active':
			return 'success';
		case 'invited':
			return 'info';
		default:
			return 'neutral';
	}
}

/** `Berlin · Hybrid` — the office and how the person works from it, when both exist. */
export function locationLine(office: string | null, locationLabel: string | null): string | null {
	return [office, locationLabel].filter(Boolean).join(' · ') || null;
}

/** A stored `2026-09-01` as the user reads it. Dates carry no time of day. */
export function formatDate(value: string | null, locale: string): string | null {
	if (!value) return null;

	const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return value;

	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}
