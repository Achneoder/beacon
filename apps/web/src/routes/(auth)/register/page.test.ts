import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import '$lib/i18n';
import RegisterPage from './+page.svelte';
import { session } from '$lib/auth/session.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

const VALID = {
	'Organization name': 'Acme',
	'First name': 'Ada',
	'Last name': 'Lovelace',
	'Email address': 'owner@acme.test',
	Password: 'correct-horse-battery',
	'Confirm password': 'correct-horse-battery'
};

beforeEach(async () => {
	goto.mockClear();
	await waitLocale('en');
});
afterEach(() => vi.restoreAllMocks());

async function fill(values: Record<string, string>) {
	for (const [label, value] of Object.entries(values)) {
		await fireEvent.input(screen.getByLabelText(label), { target: { value } });
	}
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

describe('register page validation', () => {
	it('rejects a malformed email instead of silently doing nothing', async () => {
		const register = vi.spyOn(session, 'register').mockResolvedValue();
		render(RegisterPage);

		await fill({ ...VALID, 'Email address': 'owner@acme' });
		await submit();

		expect(register).not.toHaveBeenCalled();
		expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription(
			'Enter a valid email address.'
		);
		// The old `email.includes('@')` check accepted this and the submit no-opped.
		expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted fields.');
	});

	it.each([
		['@', 'Enter a valid email address.'],
		['owner@acme', 'Enter a valid email address.'],
		['', 'This field is required.']
	])('explains why %s is not an address', async (value, message) => {
		vi.spyOn(session, 'register').mockResolvedValue();
		render(RegisterPage);

		await fill({ ...VALID, 'Email address': value });
		await submit();

		expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription(message);
	});

	it('moves focus to the first invalid field', async () => {
		vi.spyOn(session, 'register').mockResolvedValue();
		render(RegisterPage);

		await fill({ ...VALID, 'Organization name': '', 'Email address': 'nope' });
		await submit();

		expect(screen.getByLabelText('Organization name')).toHaveFocus();
	});

	it('flags a mismatched confirmation', async () => {
		const register = vi.spyOn(session, 'register').mockResolvedValue();
		render(RegisterPage);

		await fill({ ...VALID, 'Confirm password': 'correct-horse-batteries' });
		await submit();

		expect(register).not.toHaveBeenCalled();
		expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true');
	});

	it('says nothing until the first submit', async () => {
		render(RegisterPage);

		await fill({ 'Email address': 'nope' });

		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(screen.getByLabelText('Email address')).not.toHaveAttribute('aria-invalid');
	});

	it('clears a message once the field is corrected', async () => {
		vi.spyOn(session, 'register').mockResolvedValue();
		render(RegisterPage);

		await fill({ ...VALID, 'Email address': 'nope' });
		await submit();
		expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');

		await fill({ 'Email address': 'owner@acme.test' });

		expect(screen.getByLabelText('Email address')).not.toHaveAttribute('aria-invalid');
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('submits trimmed values and navigates on success', async () => {
		const register = vi.spyOn(session, 'register').mockResolvedValue();
		render(RegisterPage);

		await fill({ ...VALID, 'Email address': '  owner@acme.test  ', 'First name': ' Ada ' });
		await submit();

		expect(register).toHaveBeenCalledWith({
			organizationName: 'Acme',
			firstName: 'Ada',
			lastName: 'Lovelace',
			email: 'owner@acme.test',
			password: 'correct-horse-battery'
		});
		expect(goto).toHaveBeenCalledWith('/');
	});

	it('surfaces the server response when registration is refused', async () => {
		vi.spyOn(session, 'register').mockRejectedValue(new Error('offline'));
		render(RegisterPage);

		await fill(VALID);
		await submit();

		expect(await screen.findByRole('alert')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});
});
