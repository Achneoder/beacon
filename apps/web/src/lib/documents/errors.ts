import { ApiError } from '$lib/api/client';
import { UploadRejected } from '$lib/api/documents';
import { errorKey } from '$lib/auth/errors';

/**
 * Business-rule refusals from the documents API, as translation keys — the same
 * pattern as `$lib/absence/errors.ts`. Matching on message text is still the weak
 * part: the API has no machine-readable error code to match on instead, so this map
 * is the seam, in one file, with a test that pins every string it depends on.
 */
const REFUSALS: { fragment: string; key: string }[] = [
	{ fragment: 'only pdf, docx and jpg', key: 'errors.documentType' },
	{ fragment: 'exceeds the 20 mb limit', key: 'errors.documentTooLarge' },
	{ fragment: 'a file is required', key: 'errors.documentFileRequired' },
	{ fragment: 'document not found', key: 'errors.documentNotFound' },
	{ fragment: 'may not add a version', key: 'errors.documentNotWritable' },
	{ fragment: "someone else's documents", key: 'errors.documentNotYours' },
	{ fragment: 'retained until', key: 'errors.documentRetained' },
	{ fragment: 'document store is unavailable', key: 'errors.documentStorageDown' },
	{ fragment: 'uploaded at the same time', key: 'errors.documentVersionRace' },
	{ fragment: 'key is already in use', key: 'errors.documentCategoryKey' }
];

export function documentErrorKey(error: unknown): string {
	if (error instanceof UploadRejected) return error.key;

	if (error instanceof ApiError) {
		const message = error.message.toLowerCase();
		const known = REFUSALS.find((refusal) => message.includes(refusal.fragment));

		if (known) return known.key;
	}

	return errorKey(error);
}
