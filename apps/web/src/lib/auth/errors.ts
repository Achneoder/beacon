import { ApiError } from '$lib/api/client';

/**
 * Maps a failed request onto a translation key. Server messages are never shown raw —
 * they are English-only and phrased for developers.
 */
export function errorKey(error: unknown): string {
	if (!(error instanceof ApiError)) return 'errors.network';

	switch (error.status) {
		case 400:
			return 'errors.unexpected';
		case 401:
			return 'errors.invalidCredentials';
		case 403:
			return 'errors.forbidden';
		case 409:
			return 'errors.conflict';
		case 429:
			return 'errors.rateLimited';
		default:
			return 'errors.unexpected';
	}
}
