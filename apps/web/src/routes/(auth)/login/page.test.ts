import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import '$lib/i18n';
import LoginPage from './+page.svelte';
import { session } from '$lib/auth/session.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

beforeEach(async () => {
	goto.mockClear();
	await waitLocale('en');
});
afterEach(() => vi.restoreAllMocks());

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

	it('announces a rejected sign-in and stays put', async () => {
		vi.spyOn(session, 'login').mockRejectedValue(new Error('nope'));
		render(LoginPage);

		await signIn();

		// role="alert", so a screen reader hears it without moving focus.
		expect(await screen.findByRole('alert')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});
});
