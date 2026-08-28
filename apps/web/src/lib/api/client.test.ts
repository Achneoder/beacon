import { describe, expect, it, vi, afterEach } from 'vitest';
import { ApiError, api } from './client';

describe('api', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('returns parsed json for a successful response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '1' }), { status: 200 }))
		);

		await expect(api<{ id: string }>('/users/me')).resolves.toEqual({ id: '1' });
	});

	it('throws ApiError carrying the status code', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));

		await expect(api('/organizations')).rejects.toBeInstanceOf(ApiError);
	});

	it('returns undefined for 204 responses', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

		await expect(api('/sessions')).resolves.toBeUndefined();
	});
});
