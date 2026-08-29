import { describe, expect, it } from 'vitest';
import { formatRange, rangeFor, reportYears } from './ranges';

describe('rangeFor', () => {
	it('runs this month from the first to today, not to the month end', () => {
		// Padding the rest of the month with unworked days would report everyone as
		// behind on the 2nd of every month.
		expect(rangeFor('thisMonth', '2026-08-29')).toEqual({ from: '2026-08-01', to: '2026-08-29' });
	});

	it('runs last month end to end', () => {
		expect(rangeFor('lastMonth', '2026-08-29')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
	});

	it('crosses the year boundary backwards in January', () => {
		expect(rangeFor('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
	});

	it('gets February right in a leap year', () => {
		expect(rangeFor('lastMonth', '2028-03-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
	});

	it.each([
		['2026-02-14', '2026-01-01'],
		['2026-08-29', '2026-07-01'],
		['2026-12-31', '2026-10-01']
	])('starts the quarter containing %s at %s', (today, from) => {
		expect(rangeFor('thisQuarter', today)).toEqual({ from, to: today });
	});

	it('runs this year from January', () => {
		expect(rangeFor('thisYear', '2026-08-29')).toEqual({ from: '2026-01-01', to: '2026-08-29' });
	});
});

/**
 * ICU sets a range dash between thin spaces (U+2009), not ordinary ones. Comparing
 * against typed-out literals would pin this file to one ICU version's typography,
 * which is not what any of these tests are about.
 */
const spaced = (range: { from: string; to: string }, locale: string) =>
	formatRange(range, locale).replaceAll(/\s/gu, ' ');

describe('formatRange', () => {
	it('names the month once when both ends share it', () => {
		expect(spaced({ from: '2026-08-01', to: '2026-08-29' }, 'en')).toBe('August 1 – 29, 2026');
	});

	it('names both months when the range straddles one', () => {
		expect(spaced({ from: '2026-07-01', to: '2026-08-29' }, 'en')).toBe('July 1 – August 29, 2026');
	});

	it('writes the German range the German way, not the English one with commas', () => {
		// The reason this goes through Intl.formatRange rather than two format() calls
		// joined by a dash: where the shared month goes differs by locale.
		expect(formatRange({ from: '2026-08-01', to: '2026-08-29' }, 'de')).toBe('1.–29. August 2026');
	});

	it('falls back to the raw dates rather than printing Invalid Date', () => {
		expect(formatRange({ from: 'nonsense', to: '2026-08-29' }, 'en')).toBe('nonsense – 2026-08-29');
	});
});

describe('reportYears', () => {
	it('offers next year too, because approved holiday is booked ahead', () => {
		expect(reportYears('2026-08-29')).toEqual([2027, 2026, 2025, 2024]);
	});
});
