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
 * Thin fetch wrapper around the NestJS REST API.
 *
 * Request and response shapes come from `@beacon/shared` — never redeclare a DTO here.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${BASE_URL}${path}`, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...init.headers
		}
	});

	if (!response.ok) {
		throw new ApiError(response.status, `${init.method ?? 'GET'} ${path} failed`);
	}

	return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
