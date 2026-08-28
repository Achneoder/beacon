import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import '$lib/i18n';
import ThemeToggle from './ThemeToggle.svelte';
import { theme } from '$lib/theme.svelte';

beforeEach(async () => {
	vi.restoreAllMocks();
	theme.set('system');
	await waitLocale('en');
});

describe('ThemeToggle', () => {
	it('is one radio group, so arrow keys move between the three options', () => {
		render(ThemeToggle);

		expect(screen.getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
		expect(screen.getAllByRole('radio')).toHaveLength(3);
		expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
	});

	it('applies and pins the chosen theme', async () => {
		render(ThemeToggle);

		await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

		expect(theme.current).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
	});
});
