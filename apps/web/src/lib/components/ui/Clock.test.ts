import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Clock from './Clock.svelte';

describe('Clock', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('renders a fixed count as padded HH:MM:SS', () => {
		render(Clock, { props: { seconds: 3 * 3600 + 7 * 60 + 9 } });

		expect(screen.getByText('03:07:09')).toBeInTheDocument();
	});

	it('exposes the value as a machine-readable duration', () => {
		const { container } = render(Clock, { props: { seconds: 90 } });

		expect(container.querySelector('time')).toHaveAttribute('datetime', 'PT0H1M30S');
	});

	it('counts up from a server-supplied instant', async () => {
		vi.setSystemTime(new Date('2026-08-28T09:12:20Z'));
		render(Clock, { props: { since: '2026-08-28T09:12:00Z' } });

		expect(screen.getByText('00:00:20')).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(5000);

		expect(screen.getByText('00:00:25')).toBeInTheDocument();
	});

	it('recovers the whole gap after the timer stops firing', async () => {
		// A sleeping laptop drops its intervals. Because each tick subtracts two
		// instants rather than incrementing, one late tick catches the clock all the way
		// up — a self-accumulating counter would still read 00:00:00.
		vi.setSystemTime(new Date('2026-08-28T09:00:00Z'));
		render(Clock, { props: { since: '2026-08-28T09:00:00Z' } });

		// `advanceTimersByTime` moves the mocked clock too, so this lands on 11:30:45.
		vi.setSystemTime(new Date('2026-08-28T11:30:44Z'));
		await vi.advanceTimersByTimeAsync(1000);

		expect(screen.getByText('02:30:45')).toBeInTheDocument();
	});
});
