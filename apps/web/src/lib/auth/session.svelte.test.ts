import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SessionUser } from '@beacon/shared';
import { session } from './session.svelte';
import { getAccessToken } from '$lib/api/client';

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

const authResponse = (token = 'token-abc') =>
	new Response(JSON.stringify({ accessToken: token, expiresIn: 900, user }), {
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
});
