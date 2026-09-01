import { describe, expect, it, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { locale } from 'svelte-i18n';
import type { SessionUser } from '@beacon/shared';
import { session } from './session.svelte';
import { apiSend, getAccessToken } from '$lib/api/client';
import '$lib/i18n';

const user: SessionUser = {
	id: 'u1',
	organizationId: 'o1',
	email: 'owner@acme.test',
	permissions: ['organization:read', 'organization:manage'],
	firstName: 'Ada',
	lastName: 'Lovelace',
	locale: 'en',
	timezone: null,
	jobTitle: null,
	roleKeys: ['owner'],
	organizationName: 'Acme',
	organizationSlug: 'acme'
};

const authResponse = (token = 'token-abc', overrides: Partial<SessionUser> = {}) =>
	new Response(
		JSON.stringify({ accessToken: token, expiresIn: 900, user: { ...user, ...overrides } }),
		{
			status: 200,
			headers: { 'content-type': 'application/json' }
		}
	);

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

afterEach(() => vi.unstubAllGlobals());

describe('session', () => {
	it('signs in and keeps the token out of storage', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse()));

		await session.login({ email: user.email, password: 'correct-horse-battery' });

		expect(session.isAuthenticated).toBe(true);
		expect(session.user?.organizationName).toBe('Acme');
		expect(getAccessToken()).toBe('token-abc');
		expect(localStorage.getItem('beacon-session')).toBeNull();
	});

	it('answers permission questions from the signed-in user', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse()));
		await session.login({ email: user.email, password: 'correct-horse-battery' });

		expect(session.can('organization:manage')).toBe(true);
		expect(session.can('attendance:approve')).toBe(false);
	});

	it('restores a session from the refresh cookie on start-up', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse('restored')));

		await session.bootstrap();

		expect(session.status).toBe('authenticated');
		expect(getAccessToken()).toBe('restored');
	});

	it('lands on anonymous — not an error — when there is no valid cookie', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		await expect(session.bootstrap()).resolves.toBeUndefined();

		expect(session.status).toBe('anonymous');
		expect(session.user).toBeNull();
		expect(session.can('organization:read')).toBe(false);
	});

	it('clears the local session even if the logout request fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse()));
		await session.login({ email: user.email, password: 'correct-horse-battery' });

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		await expect(session.logout()).rejects.toThrow('offline');

		expect(session.status).toBe('anonymous');
		expect(getAccessToken()).toBeNull();
	});

	// The API resolves the language — the user's own choice, or the organization's
	// default when they never made one — so signing in is what puts the SPA into it.
	// Without this the whole app stayed on the browser's language whatever Settings said.
	it('renders in the language the API resolved for the account', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse('token-de', { locale: 'de' })));

		await session.login({ email: user.email, password: 'correct-horse-battery' });

		expect(get(locale)).toBe('de');
	});

	it('follows the language again when the session is re-read', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse('token-de', { locale: 'de' })));
		await session.login({ email: user.email, password: 'correct-horse-battery' });

		// What Settings → Organization does after saving a new default language, so the
		// person who changed it sees it without reloading the app.
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...user, locale: 'en' })));
		await session.reload();

		expect(get(locale)).toBe('en');
		expect(session.user?.locale).toBe('en');
	});

	it('drops to anonymous when a mid-session refresh fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse()));
		await session.login({ email: user.email, password: 'correct-horse-battery' });

		// The access token is dead and the refresh cookie has expired with it: every
		// request 401s, including the refresh. The user must land on the login screen,
		// not sit inside an authenticated shell that can only fail.
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		await expect(apiSend('/timesheet', 'GET')).rejects.toMatchObject({ status: 401 });

		expect(session.status).toBe('anonymous');
		expect(getAccessToken()).toBeNull();
	});
});
