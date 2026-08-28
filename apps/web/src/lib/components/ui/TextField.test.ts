import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TextField from './TextField.svelte';

describe('TextField', () => {
	it('uses the label as the accessible name', () => {
		render(TextField, { props: { id: 'email', label: 'Email address', value: '' } });

		expect(screen.getByLabelText('Email address')).toBeInTheDocument();
	});

	it('marks the field invalid and links its error message', () => {
		render(TextField, {
			props: { id: 'password', label: 'Password', value: 'short', error: 'Use 12 characters.' }
		});

		const input = screen.getByLabelText('Password');
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input).toHaveAccessibleDescription('Use 12 characters.');
	});

	it('describes the field by its hint when there is no error', () => {
		render(TextField, {
			props: { id: 'org', label: 'Organization', value: '', hint: 'beacon.app/acme' }
		});

		expect(screen.getByLabelText('Organization')).toHaveAccessibleDescription('beacon.app/acme');
	});

	it('leaves a valid field undescribed rather than pointing at nothing', () => {
		render(TextField, { props: { id: 'org', label: 'Organization', value: '' } });

		const input = screen.getByLabelText('Organization');
		expect(input).not.toHaveAttribute('aria-describedby');
		expect(input).not.toHaveAttribute('aria-invalid');
	});
});
