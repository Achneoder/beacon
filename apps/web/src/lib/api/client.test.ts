import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { ApiError, api, apiSend, apiUpload, setAccessToken } from './client';

/** Builds a fetch stub that answers each call from a queue of responses. */
function stubFetch(...responses: Response[]) {
	const fetchMock = vi.fn();
	for (const response of responses) fetchMock.mockResolvedValueOnce(response);
	vi.stubGlobal('fetch', fetchMock);

	return fetchMock;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unauthorized = () => new Response('', { status: 401 });

beforeEach(() => setAccessToken(null));
afterEach(() => {
	vi.unstubAllGlobals();
	setAccessToken(null);
});

describe('api', () => {
	it('returns parsed json for a successful response', async () => {
		stubFetch(json({ id: '1' }));

		await expect(api<{ id: string }>('/users/me')).resolves.toEqual({ id: '1' });
	});

	it('returns undefined for 204 responses', async () => {
		stubFetch(new Response(null, { status: 204 }));

		await expect(api('/sessions')).resolves.toBeUndefined();
	});

	it('sends the access token once one is set', async () => {
		setAccessToken('token-abc');
		const fetchMock = stubFetch(json({}));

		await api('/organizations/current');

		const headers = fetchMock.mock.calls[0][1].headers as Headers;
		expect(headers.get('Authorization')).toBe('Bearer token-abc');
	});

	it('omits the header while signed out', async () => {
		const fetchMock = stubFetch(json({}));

		await api('/health');

		expect((fetchMock.mock.calls[0][1].headers as Headers).has('Authorization')).toBe(false);
	});

	it('surfaces the server message instead of a generic one', async () => {
		stubFetch(json({ statusCode: 409, message: 'slug already taken' }, 409));

		await expect(api('/auth/register', { method: 'POST' })).rejects.toMatchObject({
			status: 409,
			message: 'slug already taken'
		});
	});

	it('joins the array of messages a validation failure returns', async () => {
		stubFetch(
			json({ statusCode: 400, message: ['email must be an email', 'password too short'] }, 400)
		);

		await expect(api('/auth/register', { method: 'POST' })).rejects.toThrow(
			'email must be an email, password too short'
		);
	});

	it('falls back to a generic message when the body is not json', async () => {
		stubFetch(new Response('gateway down', { status: 502 }));

		await expect(api('/organizations/current')).rejects.toBeInstanceOf(ApiError);
	});
});

describe('token refresh', () => {
	it('refreshes once and retries the request that expired', async () => {
		setAccessToken('expired');
		const fetchMock = stubFetch(
			unauthorized(),
			json({ accessToken: 'fresh' }),
			json({ id: 'org-1' })
		);

		await expect(api<{ id: string }>('/organizations/current')).resolves.toEqual({ id: 'org-1' });

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(fetchMock.mock.calls[1][0]).toContain('/auth/refresh');
		// The retry carries the new token, not the expired one.
		expect((fetchMock.mock.calls[2][1].headers as Headers).get('Authorization')).toBe(
			'Bearer fresh'
		);
	});

	it('gives up and reports the original failure when the refresh fails', async () => {
		setAccessToken('expired');
		const fetchMock = stubFetch(unauthorized(), unauthorized());

		await expect(api('/organizations/current')).rejects.toMatchObject({ status: 401 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('refreshes only once for several requests that expire together', async () => {
		setAccessToken('expired');
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/auth/refresh')) return json({ accessToken: 'fresh' });

			return fetchMock.mock.calls.filter(([u]) => !String(u).includes('/auth/')).length <= 3
				? unauthorized()
				: json({ ok: true });
		});
		vi.stubGlobal('fetch', fetchMock);

		await Promise.all([api('/a'), api('/b'), api('/c')]);

		const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes('/auth/refresh')
		);
		expect(refreshCalls).toHaveLength(1);
	});

	it('never retries an auth route, so a bad login does not loop', async () => {
		const fetchMock = stubFetch(unauthorized());

		await expect(
			apiSend('/auth/login', 'POST', { email: 'a@b.test', password: 'wrong' })
		).rejects.toMatchObject({ status: 401 });

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('apiSend', () => {
	it('serializes the body as json', async () => {
		const fetchMock = stubFetch(json({}));

		await apiSend('/auth/login', 'POST', { email: 'a@b.test' });

		expect(fetchMock.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			body: '{"email":"a@b.test"}'
		});
	});

	it('sends no body when there is nothing to send', async () => {
		const fetchMock = stubFetch(json({}));

		await apiSend('/auth/refresh', 'POST');

		expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
	});
});

describe('apiUpload', () => {
	it('sends the FormData body without setting its own Content-Type', async () => {
		const fetchMock = stubFetch(json({ id: 'doc-1' }));
		const form = new FormData();
		form.set('title', 'Contract');

		await apiUpload('/documents', form);

		const [, init] = fetchMock.mock.calls[0];
		expect(init.body).toBe(form);
		expect((init.headers as Headers).has('Content-Type')).toBe(false);
	});

	it('retries the same FormData instance after a token refresh', async () => {
		setAccessToken('expired');
		const fetchMock = stubFetch(
			unauthorized(),
			json({ accessToken: 'fresh' }),
			json({ id: 'doc-1' })
		);
		const form = new FormData();
		form.set('title', 'Contract');

		await expect(apiUpload('/documents', form)).resolves.toEqual({ id: 'doc-1' });

		expect(fetchMock.mock.calls[0][1].body).toBe(form);
		expect(fetchMock.mock.calls[2][1].body).toBe(form);
		expect((fetchMock.mock.calls[2][1].headers as Headers).get('Authorization')).toBe(
			'Bearer fresh'
		);
	});
});
