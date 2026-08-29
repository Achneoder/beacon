import { isSsoErrorCode } from '@beacon/shared';
import { ApiError } from '$lib/api/client';

/**
 * Maps a failed request onto a translation key. Server messages are never shown raw —
 * they are English-only and phrased for developers. The one exception is a 403 whose
 * message is a closed `SsoErrorCode` — `AuthService.login` throws exactly one of those
 * when SSO is enforced, and `ssoErrorKey` maps the same set from the callback redirect,
 * so both paths land on the same `errors.sso.*` copy.
 */
export function errorKey(error: unknown): string {
	if (!(error instanceof ApiError)) return 'errors.network';

	if (error.status === 403 && isSsoErrorCode(error.message)) {
		return `errors.sso.${error.message}`;
	}

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

/** Maps the `?error=` the sso callback redirects with onto its copy — the same closed
 * set `errorKey` reads off a 403's message, reached here without an `ApiError` to unwrap. */
export function ssoErrorKey(code: string | null): string | null {
	if (!code) return null;

	return isSsoErrorCode(code) ? `errors.sso.${code}` : 'errors.unexpected';
}
