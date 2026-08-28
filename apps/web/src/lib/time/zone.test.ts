import { describe, expect, it } from 'vitest';
import {
	formatHeaderDate,
	resolveTimezone,
	timezoneAbbreviation,
	timezoneCity,
	timezoneLabel
} from './zone';

const SUMMER = new Date('2026-08-28T10:00:00Z');
const WINTER = new Date('2026-01-15T10:00:00Z');

describe('resolveTimezone', () => {
	it('prefers the user’s own zone', () => {
		expect(resolveTimezone('Europe/Berlin')).toBe('Europe/Berlin');
	});

	it('falls back to the browser when the user has none', () => {
		expect(resolveTimezone(null)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
		expect(resolveTimezone('  ')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
	});
});

describe('timezoneCity', () => {
	it('takes the city half and unescapes the underscore', () => {
		expect(timezoneCity('Europe/Berlin')).toBe('Berlin');
		expect(timezoneCity('America/New_York')).toBe('New York');
	});

	it('leaves a region-less zone alone', () => {
		expect(timezoneCity('UTC')).toBe('UTC');
	});
});

describe('timezoneAbbreviation', () => {
	it('initials the long name where the locale only offers an offset', () => {
		// English says "GMT+2" for Europe/Berlin, so "Central European Summer Time" wins.
		expect(timezoneAbbreviation('Europe/Berlin', 'en', SUMMER)).toBe('CEST');
	});

	it('follows daylight saving', () => {
		expect(timezoneAbbreviation('Europe/Berlin', 'en', WINTER)).toBe('CET');
	});

	it('keeps a locale’s own abbreviation', () => {
		expect(timezoneAbbreviation('Europe/Berlin', 'de', SUMMER)).toBe('MESZ');
		expect(timezoneAbbreviation('America/New_York', 'en', SUMMER)).toBe('EDT');
	});
});

describe('timezoneLabel', () => {
	it('reads "City · ABBR"', () => {
		expect(timezoneLabel('Europe/Berlin', 'en', SUMMER)).toBe('Berlin · CEST');
	});
});

describe('formatHeaderDate', () => {
	it('spells out the weekday in the user’s locale and zone', () => {
		expect(formatHeaderDate(SUMMER, 'Europe/Berlin', 'en-GB')).toBe('Friday, 28 August 2026');
		expect(formatHeaderDate(SUMMER, 'Europe/Berlin', 'de')).toBe('Freitag, 28. August 2026');
	});

	it('uses the zone, not the runtime’s, to decide the day', () => {
		const lateUtc = new Date('2026-08-28T23:30:00Z');
		expect(formatHeaderDate(lateUtc, 'Europe/Berlin', 'en-GB')).toBe('Saturday, 29 August 2026');
	});
});
