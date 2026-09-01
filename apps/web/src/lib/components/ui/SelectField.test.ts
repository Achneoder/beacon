import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import SelectField from './SelectField.svelte';

/**
 * The `<option>`s a caller would pass — a raw snippet is the cheapest stand-in, and
 * it has a single root, so the group doubles as the `<optgroup>` case.
 */
const options = createRawSnippet(() => ({
	render: () =>
		'<optgroup label="Languages"><option value="en">English</option>' +
		'<option value="de">German</option></optgroup>'
}));

describe('SelectField', () => {
	it('uses the label as the accessible name and offers the options given', () => {
		render(SelectField, {
			props: { id: 'language', label: 'Language', value: 'en', children: options }
		});

		const select = screen.getByLabelText('Language');
		expect(select).toHaveValue('en');
		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
			'English',
			'German'
		]);
	});

	it('marks the field invalid and links its error message', () => {
		render(SelectField, {
			props: {
				id: 'language',
				label: 'Language',
				value: '',
				error: 'Choose a language.',
				children: options
			}
		});

		const select = screen.getByLabelText('Language');
		expect(select).toHaveAttribute('aria-invalid', 'true');
		expect(select).toHaveAccessibleDescription('Choose a language.');
	});

	it('describes the field by its hint when there is no error', () => {
		render(SelectField, {
			props: {
				id: 'zone',
				label: 'Time zone',
				value: '',
				hint: 'Everyone falls back to this one.',
				children: options
			}
		});

		expect(screen.getByLabelText('Time zone')).toHaveAccessibleDescription(
			'Everyone falls back to this one.'
		);
	});

	it('leaves a valid field undescribed rather than pointing at nothing', () => {
		render(SelectField, {
			props: { id: 'zone', label: 'Time zone', value: '', children: options }
		});

		const select = screen.getByLabelText('Time zone');
		expect(select).not.toHaveAttribute('aria-describedby');
		expect(select).not.toHaveAttribute('aria-invalid');
	});
});
