import { ApiError } from '$lib/api/client';
import { errorKey } from '$lib/auth/errors';

/**
 * Business-rule refusals from the absence API, as translation keys.
 *
 * Every one of these arrives as a plain 400 or 403, which `errorKey` can only render
 * as "Something went wrong" — useless advice when the fix is "those days are already
 * booked". Server messages are still never shown raw: they are English and phrased
 * for developers, so they are matched and replaced, not printed.
 *
 * Matching on message text is the weak part, and it is weak because the API has no
 * machine-readable error code to match on instead. Adding one is the durable fix and
 * is recorded in the roadmap; until then this map is the seam, in one file, with a
 * test that pins every string it depends on.
 */
const REFUSALS: { fragment: string; key: string }[] = [
	{ fragment: 'already carry an absence', key: 'errors.absenceOverlap' },
	{ fragment: 'no working days', key: 'errors.absenceNoWorkingDays' },
	{ fragment: 'must not precede', key: 'errors.absenceBackwards' },
	{ fragment: 'already been decided', key: 'errors.absenceDecided' },
	{ fragment: 'cannot decide your own', key: 'errors.absenceOwnDecision' },
	{ fragment: 'only a pending request', key: 'errors.absencePendingOnly' },
	{ fragment: 'may only withdraw your own', key: 'errors.absenceNotYours' },
	{ fragment: 'may only request your own', key: 'errors.absenceNotYours' }
];

export function absenceErrorKey(error: unknown): string {
	if (error instanceof ApiError) {
		const message = error.message.toLowerCase();
		const known = REFUSALS.find((refusal) => message.includes(refusal.fragment));

		if (known) return known.key;
	}

	return errorKey(error);
}
