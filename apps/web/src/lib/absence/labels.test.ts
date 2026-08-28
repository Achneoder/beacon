import { describe, expect, it } from 'vitest';
import {
	cellTint,
	formatMonth,
	formatRange,
	gridRange,
	monthOf,
	shiftMonth,
	statusTone,
	toneOf,
	typeName
} from './labels';

describe('toneOf', () => {
	it('maps the palette roles the UI knows straight through', () => {
		expect(toneOf('accent')).toBe('accent');
		expect(toneOf('warning')).toBe('warning');
	});

	it('reads muted as the absence of emphasis', () => {
		// The UI palette names semantic roles only; `muted` has no counterpart there.
		expect(toneOf('muted')).toBe('neutral');
	});
});

describe('cellTint', () => {
	it('gives every role a soft background and a readable foreground', () => {
		expect(cellTint('accent')).toContain('bg-accent-soft');
		expect(cellTint('muted')).toContain('text-ink-muted');
	});
});

describe('typeName', () => {
	const translate = (key: string) => (key === 'absence.type.vacation' ? 'Urlaub' : key);

	it('prefers the translation of a seeded type', () => {
		expect(typeName({ key: 'vacation', name: 'Vacation' }, translate)).toBe('Urlaub');
	});

	it('falls back to whatever the organization called its own type', () => {
		// Nothing translates `sabbatical` — it is not one of the eight seeds.
		expect(typeName({ key: 'sabbatical', name: 'Sabbatical' }, translate)).toBe('Sabbatical');
	});
});

describe('statusTone', () => {
	it('separates a question from a settled answer', () => {
		expect(statusTone('pending')).toBe('warning');
		expect(statusTone('approved')).toBe('success');
		expect(statusTone('taken')).toBe('info');
		// A refusal is an answer, not a fault.
		expect(statusTone('rejected')).toBe('neutral');
	});
});

describe('formatMonth', () => {
	it('spells the month out in the user’s locale', () => {
		expect(formatMonth('2026-08', 'en')).toBe('August 2026');
		expect(formatMonth('2026-08', 'de')).toBe('August 2026');
	});
});

describe('formatRange', () => {
	it('collapses to a single date when the range is one day', () => {
		expect(formatRange('2026-08-28', '2026-08-28', 'en')).toBe('Aug 28, 2026');
	});

	it('spells both ends otherwise', () => {
		expect(formatRange('2026-08-24', '2026-08-28', 'en')).toBe('Aug 24, 2026 – Aug 28, 2026');
		// German puts the day first, which is the whole point of asking Intl.
		expect(formatRange('2026-08-24', '2026-08-28', 'de')).toBe('24. Aug. 2026 – 28. Aug. 2026');
	});
});

describe('month arithmetic', () => {
	it('reads the month out of a date', () => {
		expect(monthOf('2026-08-28')).toBe('2026-08');
	});

	it('pages across a year boundary', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
	});
});

describe('gridRange', () => {
	it('starts on the Monday on or before the first of the month', () => {
		// 1 August 2026 is a Saturday, so the grid opens on Monday 27 July.
		expect(gridRange('2026-08').from).toBe('2026-07-27');
	});

	it('is always six weeks, so the panel below never jumps', () => {
		for (const month of ['2026-02', '2026-08', '2027-01']) {
			const { from, to } = gridRange(month);
			const days =
				(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

			expect(days).toBe(42);
		}
	});

	it('opens on the first itself when that is already a Monday', () => {
		// 1 June 2026 is a Monday.
		expect(gridRange('2026-06').from).toBe('2026-06-01');
	});
});
