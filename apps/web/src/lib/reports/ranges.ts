/**
 * The ranges the reports screen offers, as pure date arithmetic.
 *
 * All of it in UTC on `YYYY-MM-DD` strings, the same way `@beacon/shared` does it:
 * these are local calendar dates the server resolves in the organization's zone, and
 * letting the browser's zone reinterpret them would shift a month boundary for
 * anyone west of Greenwich.
 */

export const REPORT_RANGES = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'] as const;

export type ReportRangeKey = (typeof REPORT_RANGES)[number];

export interface DateRange {
	from: string;
	to: string;
}

function iso(year: number, month: number, day: number): string {
	return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** The last day of a month, without a table of month lengths or a leap-year rule. */
function endOfMonth(year: number, month: number): string {
	return iso(year, month + 1, 0);
}

export function rangeFor(key: ReportRangeKey, today: string): DateRange {
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7)) - 1;

	switch (key) {
		case 'lastMonth': {
			const at = new Date(Date.UTC(year, month - 1, 1));

			return {
				from: at.toISOString().slice(0, 10),
				to: endOfMonth(at.getUTCFullYear(), at.getUTCMonth())
			};
		}
		case 'thisQuarter': {
			const first = Math.floor(month / 3) * 3;

			// To today rather than to the quarter's end: a report that padded the rest
			// of the quarter with unworked days would say everyone is behind.
			return { from: iso(year, first, 1), to: today };
		}
		case 'thisYear':
			return { from: iso(year, 0, 1), to: today };
		default:
			return { from: iso(year, month, 1), to: today };
	}
}

export function rangeLabelKey(key: ReportRangeKey): string {
	return `reports.range.${key}`;
}

/**
 * The range as one phrase — `August 1 – 29, 2026`, `1.–29. August 2026`.
 *
 * `Intl.DateTimeFormat.formatRange` rather than two formatted dates and a dash: it
 * is the part that knows a shared month or year is written once, and it knows it
 * differently in German than in English. Joining two `format()` calls by hand gets
 * one locale right and the other wrong.
 */
export function formatRange(range: DateRange, locale: string): string {
	const from = new Date(`${range.from}T00:00:00Z`);
	const to = new Date(`${range.to}T00:00:00Z`);
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
		return `${range.from} – ${range.to}`;
	}

	return new Intl.DateTimeFormat(locale, {
		timeZone: 'UTC',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).formatRange(from, to);
}

/** The four years the absence report offers, newest first. */
export function reportYears(today: string): number[] {
	const year = Number(today.slice(0, 4));

	return [year + 1, year, year - 1, year - 2];
}
