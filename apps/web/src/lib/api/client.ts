import { env } from '$env/dynamic/public';

const BASE_URL = env.PUBLIC_API_URL ?? 'http://localhost:3000/api';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/**
 * The access token lives in memory only — never in localStorage, where a script
 * injection could read it. It is short-lived; the httpOnly refresh cookie is what
 * survives a reload, and `session.bootstrap()` trades it for a fresh token on start-up.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
	accessToken = token;
}

export function getAccessToken(): string | null {
	return accessToken;
}

/** Auth routes must never trigger the refresh-and-retry dance — that would recurse. */
function isAuthPath(path: string): boolean {
	return path.startsWith('/auth/');
}

/**
 * Shared across concurrent callers, so a page firing five requests that all 401 refreshes
 * once rather than five times — and five rotations would invalidate each other.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
	inFlightRefresh ??= (async () => {
		try {
			const { accessToken: token } = await request<{ accessToken: string }>('/auth/refresh', {
				method: 'POST'
			});
			setAccessToken(token);
			return true;
		} catch {
			setAccessToken(null);
			return false;
		} finally {
			inFlightRefresh = null;
		}
	})();

	return inFlightRefresh;
}

async function toApiError(response: Response, path: string, method: string): Promise<ApiError> {
	// Nest replies with { statusCode, message, error }; surface its message so callers
	// can map it, instead of discarding the body.
	try {
		const body = (await response.json()) as { message?: string | string[] };
		const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
		if (message) return new ApiError(response.status, message);
	} catch {
		/* not JSON — fall through to the generic message */
	}

	return new ApiError(response.status, `${method} ${path} failed`);
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
	const headers = new Headers({ 'Content-Type': 'application/json', ...init.headers });
	if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

	const response = await fetch(`${BASE_URL}${path}`, {
		...init,
		credentials: 'include',
		headers
	});

	if (!response.ok) throw await toApiError(response, path, init.method ?? 'GET');

	return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * Thin fetch wrapper around the NestJS REST API.
 *
 * Request and response shapes come from `@beacon/shared` — never redeclare a DTO here.
 * An expired access token is refreshed once and the call retried, so callers only see a
 * 401 when the session is genuinely over.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	try {
		return await request<T>(path, init);
	} catch (error) {
		const expired = error instanceof ApiError && error.status === 401 && !isAuthPath(path);
		if (!expired || !(await refreshAccessToken())) throw error;

		return request<T>(path, init);
	}
}

/** Convenience for the JSON bodies every mutation sends. */
export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
	return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}
