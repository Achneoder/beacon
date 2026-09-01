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

/**
 * The refresh failing means the session is over, not just expired — the cookie that is
 * the only surviving credential is gone or refused. The session module registers here
 * so it can drop to `anonymous`; the client cannot import the session module itself
 * without a cycle.
 */
let refreshFailureHandler: (() => void) | null = null;

export function onRefreshFailure(handler: (() => void) | null): void {
	refreshFailureHandler = handler;
}

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
			refreshFailureHandler?.();
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
	// A FormData body must set no Content-Type of its own — only the browser knows the
	// multipart boundary it generated, and setting one here would corrupt every upload.
	const headers = new Headers(init.headers);
	if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
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

/**
 * Multipart uploads — documents, so far. Same auth, refresh-and-retry and error
 * mapping as every other call; `FormData` is re-serialized per `fetch`, so a 401
 * retry replays the same instance safely.
 */
export function apiUpload<T>(path: string, form: FormData, method = 'POST'): Promise<T> {
	return api<T>(path, { method, body: form });
}

/**
 * A file download — the CSV export, so far.
 *
 * It cannot be an `<a href>`. The access token lives in memory and travels in an
 * `Authorization` header, and a plain link sends neither, so the browser would be
 * handed a 401 page named `export.csv`. The bytes come back through the same
 * refresh-and-retry path as every other call and are handed to the browser as a
 * blob; `saveBlob` below does the handing.
 */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string | null }> {
	const attempt = async () => {
		const headers = new Headers();
		if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

		const response = await fetch(`${BASE_URL}${path}`, { credentials: 'include', headers });
		if (!response.ok) throw await toApiError(response, path, 'GET');

		return { blob: await response.blob(), filename: filenameOf(response) };
	};

	try {
		return await attempt();
	} catch (error) {
		const expired = error instanceof ApiError && error.status === 401;
		if (!expired || !(await refreshAccessToken())) throw error;

		return attempt();
	}
}

/** The server names the file; the client should not have to guess the range back. */
function filenameOf(response: Response): string | null {
	const header = response.headers.get('content-disposition') ?? '';
	// `filename*` first: it carries the name as it was uploaded, where the quoted form
	// beside it is an ASCII reduction the server made for browsers that need one.
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);

	if (encoded) {
		try {
			return decodeURIComponent(encoded[1]);
		} catch {
			// A malformed escape is not worth failing a download over — fall through.
		}
	}

	return /filename="([^"]+)"/.exec(header)?.[1] ?? null;
}

/**
 * Opens a downloaded blob in a new tab, falling back to saving it when the browser
 * refuses the window — a pop-up blocker is the usual reason, and a click that asked
 * to see a document must not end in nothing at all.
 *
 * Preferred over saving whenever the browser can render the type itself: the bytes
 * stay in this page's memory and die with the tab, where a saved file lingers in a
 * downloads folder. That is the same reason every API response carries
 * `Cache-Control: no-store` — Beacon runs on shared workstations.
 *
 * The object URL is revoked on a timer rather than on the next frame like `saveBlob`:
 * the new tab reads it for as long as it is open, and revoking early leaves it blank.
 */
export function openBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	// No `noopener`: it makes `window.open` return null even on success, and then a
	// blocked pop-up would be indistinguishable from an opened one. Only types the
	// API has sniffed as pdf or jpeg reach here, neither of which can script an opener.
	const opened = window.open(url, '_blank');

	if (!opened) {
		URL.revokeObjectURL(url);
		saveBlob(blob, filename);
		return;
	}

	setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
}

/** Long enough for the new tab to have read the object URL, short enough that the
 *  bytes are not held for the life of the session. */
const BLOB_URL_LIFETIME_MS = 60_000;

/**
 * Hands a downloaded blob to the browser.
 *
 * The object URL is revoked on the next frame rather than immediately: Safari has
 * not started reading it when `click()` returns, and revoking too early produces a
 * silently empty file.
 */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');

	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();

	requestAnimationFrame(() => URL.revokeObjectURL(url));
}
