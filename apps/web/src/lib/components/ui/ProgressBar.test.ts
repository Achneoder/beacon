import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ProgressBar from './ProgressBar.svelte';

describe('ProgressBar', () => {
	it('exposes an accessible progressbar with its bounds', () => {
		render(ProgressBar, { props: { value: 227, max: 360, label: 'Worked today' } });

		const bar = screen.getByRole('progressbar', { name: 'Worked today' });
		expect(bar).toHaveAttribute('aria-valuenow', '227');
		expect(bar).toHaveAttribute('aria-valuemax', '360');
	});

	it('clamps the rendered width to the 0–100% range', () => {
		render(ProgressBar, { props: { value: 500, max: 360, label: 'Worked today' } });

		const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
		expect(fill.style.width).toBe('100%');
	});
});
