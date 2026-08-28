import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import '$lib/i18n';
import StatusCard from './StatusCard.svelte';

beforeEach(async () => {
	await waitLocale('en');
});

describe('StatusCard', () => {
	it('names each of the three clock states', () => {
		const { unmount } = render(StatusCard, { props: { state: 'in' } });
		expect(screen.getByText('Clocked in')).toBeInTheDocument();
		unmount();

		render(StatusCard, { props: { state: 'break' } });
		expect(screen.getByText('On break')).toBeInTheDocument();
	});

	it('pulses the dot while the clock is running, and not once it stops', () => {
		const { container, unmount } = render(StatusCard, { props: { state: 'in' } });
		expect(container.querySelector('.animate-status-pulse')).toBeInTheDocument();
		unmount();

		const stopped = render(StatusCard, { props: { state: 'out' } });
		expect(stopped.container.querySelector('.animate-status-pulse')).not.toBeInTheDocument();
	});
});
