import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { absenceErrorKey } from './errors';

/**
 * These strings are the API's, and matching on them is the weak seam this file
 * exists to contain. Pinning each one here means a reworded server message fails a
 * test rather than silently degrading the screen to "Something went wrong".
 */
describe('absenceErrorKey', () => {
	const cases: [number, string, string][] = [
		[400, 'those days already carry an absence', 'errors.absenceOverlap'],
		[400, 'that range contains no working days', 'errors.absenceNoWorkingDays'],
		[400, 'the last day must not precede the first', 'errors.absenceBackwards'],
		[400, 'that request has already been decided', 'errors.absenceDecided'],
		[403, 'you cannot decide your own request', 'errors.absenceOwnDecision'],
		[400, 'only a pending request can be withdrawn', 'errors.absencePendingOnly'],
		[403, 'you may only withdraw your own requests', 'errors.absenceNotYours'],
		[403, 'you may only request your own absence', 'errors.absenceNotYours']
	];

	for (const [status, message, key] of cases) {
		it(`names the rule behind "${message}"`, () => {
			expect(absenceErrorKey(new ApiError(status, message))).toBe(key);
		});
	}

	it('falls back to the generic mapping for anything it does not know', () => {
		expect(absenceErrorKey(new ApiError(500, 'boom'))).toBe('errors.unexpected');
		expect(absenceErrorKey(new Error('offline'))).toBe('errors.network');
	});
});
