import type { TimeEntrySource } from '@beacon/shared';

/**
 * Formatting for time entries and the projects they book against. Enum values map to
 * translation keys, never to English strings — the same rule `attendance/labels.ts` follows.
 */

export function timeEntrySourceKey(source: TimeEntrySource): string {
	return `timeTracking.source.${source}`;
}

/**
 * A billable amount, or an em dash for a booking with no rate resolved. No currency
 * symbol: this phase stores a plain rate with no currency of its own, so a symbol here
 * would claim a unit the data does not have.
 */
export function formatAmount(amount: number | null, locale: string): string {
	if (amount === null) return '—';

	try {
		return new Intl.NumberFormat(locale, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(amount);
	} catch {
		return amount.toFixed(2);
	}
}
