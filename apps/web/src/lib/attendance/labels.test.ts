import { describe, expect, it } from 'vitest';
import {
	approvalTone,
	balanceTone,
	formatDayLabel,
	formatLockMoment,
	formatTimeOfDay,
	formatTimeRange
} from './labels';

describe('formatTimeOfDay', () => {
	it('renders the instant in the stated zone, not the browser’s', () => {
		const at = '2026-08-28T07:12:00.000Z';

		expect(formatTimeOfDay(at, 'UTC', 'en')).toBe('07:12');
		expect(formatTimeOfDay(at, 'Europe/Berlin', 'en')).toBe('09:12');
		expect(formatTimeOfDay(at, 'America/New_York', 'en')).toBe('03:12');
	});

	it('stays 24-hour in a locale that would otherwise use AM/PM', () => {
		expect(formatTimeOfDay('2026-08-28T18:30:00.000Z', 'UTC', 'en-US')).toBe('18:30');
	});

	it('has nothing to say about a missing instant', () => {
		expect(formatTimeOfDay(null, 'UTC', 'en')).toBeNull();
	});
});

describe('formatTimeRange', () => {
	it('joins the two ends of a finished segment', () => {
		expect(
			formatTimeRange(
				'2026-08-28T07:00:00.000Z',
				'2026-08-28T12:35:00.000Z',
				'Europe/Berlin',
				'en',
				'running'
			)
		).toBe('09:00 – 14:35');
	});

	it('names the open end rather than leaving it blank', () => {
		expect(formatTimeRange('2026-08-28T07:00:00.000Z', null, 'UTC', 'en', 'running')).toBe(
			'07:00 – running'
		);
	});
});

describe('tones', () => {
	it('reads a balance as good, bad or neither', () => {
		expect(balanceTone(45)).toBe('success');
		expect(balanceTone(-45)).toBe('warning');
		expect(balanceTone(0)).toBe('neutral');
	});

	it('makes a pending decision the thing that stands out', () => {
		expect(approvalTone('pending')).toBe('warning');
		expect(approvalTone('approved')).toBe('success');
		expect(approvalTone('rejected')).toBe('neutral');
	});
});

describe('date labels', () => {
	it('shortens a stored date without letting the host zone shift it', () => {
		expect(formatDayLabel('2026-08-26', 'en')).toBe('Aug 26');
		expect(formatDayLabel('2026-01-01', 'de')).toBe('1. Jan.');
	});

	it('names the lock moment as a weekday and a time in the user’s zone', () => {
		// 07:00 UTC is 09:00 in Berlin — the notice must read the local nine.
		expect(formatLockMoment('2026-08-31T07:00:00.000Z', 'Europe/Berlin', 'en')).toBe(
			'Monday 09:00'
		);
	});
});
