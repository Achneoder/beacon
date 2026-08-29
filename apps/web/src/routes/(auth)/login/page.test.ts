import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { SsoPublicState } from '@beacon/shared';
import '$lib/i18n';
import LoginPage from './+page.svelte';
import { session } from '$lib/auth/session.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/login') }));
vi.mock('$app/state', () => ({ page: pageState }));

const setupRequired = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock('$lib/auth/setup', () => ({ setupRequired }));

const getPublicState = vi.hoisted(() => vi.fn<() => Promise<SsoPublicState>>());
const startSso = vi.hoisted(() => vi.fn<() => Promise<{ authorizationUrl: string }>>());
vi.mock('$lib/api/sso', () => ({ getPublicState, startSso }));

const DISABLED: SsoPublicState = { enabled: false, displayName: null, enforced: false };

let originalLocation: Location;

beforeEach(async () => {
	goto.mockClear();
	pageState.url = new URL('http://localhost/login');
	setupRequired.mockResolvedValue(false);
	getPublicState.mockResolvedValue(DISABLED);
	startSso.mockReset();
	await waitLocale('en');

	originalLocation = window.location;
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { ...originalLocation, href: '' }
	});
});

afterEach(() => {
	Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
	vi.restoreAllMocks();
});

async function signIn() {
	await fireEvent.input(screen.getByLabelText('Email address'), {
		target: { value: 'owner@acme.test' }
	});
	await fireEvent.input(screen.getByLabelText('Password'), {
		target: { value: 'correct-horse-battery' }
	});
	await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login page', () => {
	it('labels both fields and the submit button', () => {
		render(LoginPage);

		expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
		expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
		expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
	});

	it('signs in and navigates to the dashboard', async () => {
		const login = vi.spyOn(session, 'login').mockResolvedValue();
		render(LoginPage);

		await signIn();

		expect(login).toHaveBeenCalledWith({
			email: 'owner@acme.test',
			password: 'correct-horse-battery'
		});
		expect(goto).toHaveBeenCalledWith('/');
	});

	/** Everyone but the very first visitor arrives by invitation, not by signing up. */
	it('hides the setup link once the instance has its organization', async () => {
		render(LoginPage);

		await waitFor(() => expect(setupRequired).toHaveBeenCalled());
		expect(screen.queryByRole('link', { name: 'Create one' })).not.toBeInTheDocument();
	});

	it('offers setup while the instance is still unclaimed', async () => {
		setupRequired.mockResolvedValue(true);
		render(LoginPage);

		expect(await screen.findByRole('link', { name: 'Create one' })).toHaveAttribute(
			'href',
			'/register'
		);
	});

	it('announces a rejected sign-in and stays put', async () => {
		vi.spyOn(session, 'login').mockRejectedValue(new Error('nope'));
		render(LoginPage);

		await signIn();

		// role="alert", so a screen reader hears it without moving focus.
		expect(await screen.findByRole('alert')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});

	describe('sso', () => {
		it('offers no button while no provider is configured', async () => {
			render(LoginPage);

			await waitFor(() => expect(getPublicState).toHaveBeenCalled());
			expect(screen.queryByRole('button', { name: /sign in with/i })).not.toBeInTheDocument();
			// The password form is still the only way in.
			expect(screen.getByLabelText('Email address')).toBeInTheDocument();
		});

		it('offers the button alongside the password form when enabled but not enforced', async () => {
			getPublicState.mockResolvedValue({ enabled: true, displayName: 'Okta', enforced: false });
			render(LoginPage);

			expect(await screen.findByRole('button', { name: 'Sign in with Okta' })).toBeInTheDocument();
			expect(screen.getByLabelText('Email address')).toBeInTheDocument();
		});

		it('starts the authorization request and follows the returned url', async () => {
			getPublicState.mockResolvedValue({ enabled: true, displayName: 'Okta', enforced: false });
			startSso.mockResolvedValue({
				authorizationUrl: 'https://idp.example.test/authorize?state=abc'
			});
			render(LoginPage);

			await fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Okta' }));

			await waitFor(() => expect(startSso).toHaveBeenCalled());
			expect(window.location.href).toBe('https://idp.example.test/authorize?state=abc');
		});

		it('hides the password form once sso is enforced', async () => {
			getPublicState.mockResolvedValue({ enabled: true, displayName: 'Okta', enforced: true });
			render(LoginPage);

			await screen.findByRole('button', { name: 'Sign in with Okta' });
			expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
			expect(screen.getByRole('link', { name: 'Sign in with a password instead' })).toHaveAttribute(
				'href',
				'/login?password=1'
			);
		});

		/** The admin exemption's escape hatch — organization:manage never loses the
		 * password form, but still needs a way to reach it once sso is enforced. */
		it('shows the password form again on the escape link, and hides the link itself', async () => {
			pageState.url = new URL('http://localhost/login?password=1');
			getPublicState.mockResolvedValue({ enabled: true, displayName: 'Okta', enforced: true });
			render(LoginPage);

			await screen.findByRole('button', { name: 'Sign in with Okta' });
			expect(screen.getByLabelText('Email address')).toBeInTheDocument();
			expect(
				screen.queryByRole('link', { name: 'Sign in with a password instead' })
			).not.toBeInTheDocument();
		});

		it('maps a callback failure onto its copy', async () => {
			pageState.url = new URL('http://localhost/login?error=domain_not_allowed');
			render(LoginPage);

			expect(
				await screen.findByText('That email address is not allowed to sign in this way.')
			).toBeInTheDocument();
		});
	});
});
