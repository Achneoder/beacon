import { describe, expect, it } from 'vitest';
import { contractKey, formatDate, locationLine, statusTone, workLocationKey } from './labels';

describe('label keys', () => {
	it('maps an enum value onto a translation key, never onto English', () => {
		expect(contractKey('permanent-part-time')).toBe('people.contract.permanent-part-time');
		expect(workLocationKey('hybrid')).toBe('people.workLocation.hybrid');
	});

	it('says nothing for a field the organization has not filled in', () => {
		expect(contractKey(null)).toBeNull();
		expect(workLocationKey(null)).toBeNull();
	});
});

describe('statusTone', () => {
	it('reserves the quiet tone for a disabled account', () => {
		expect(statusTone('active')).toBe('success');
		expect(statusTone('invited')).toBe('info');
		expect(statusTone('disabled')).toBe('neutral');
	});
});

describe('locationLine', () => {
	it('joins the office and the work model', () => {
		expect(locationLine('Berlin', 'Hybrid')).toBe('Berlin · Hybrid');
	});

	it('prints whichever half exists, and nothing for neither', () => {
		expect(locationLine('Berlin', null)).toBe('Berlin');
		expect(locationLine(null, 'Remote')).toBe('Remote');
		expect(locationLine(null, null)).toBeNull();
	});
});

describe('formatDate', () => {
	it('reads a stored date in the user locale, without shifting the day', () => {
		expect(formatDate('2026-09-01', 'en')).toBe('September 1, 2026');
		expect(formatDate('2026-09-01', 'de')).toBe('1. September 2026');
	});

	it('passes nulls and unparseable values straight through', () => {
		expect(formatDate(null, 'en')).toBeNull();
		expect(formatDate('not-a-date', 'en')).toBe('not-a-date');
	});
});
