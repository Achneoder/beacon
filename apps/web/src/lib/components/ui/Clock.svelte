<script lang="ts">
	import { formatClock, secondsSince } from '@beacon/shared';

	type Props = {
		/**
		 * Server-supplied instant the current state began at. While set, the clock
		 * ticks once a second.
		 */
		since?: string | Date | null;
		/** A fixed number of seconds, for a clock that is not running. */
		seconds?: number;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	};

	let { since = null, seconds = 0, size = 'md', class: extra = '' }: Props = $props();

	const sizes = {
		sm: 'text-sm',
		md: 'text-xl',
		lg: 'text-3xl'
	} as const;

	// Recomputed from `since` on every tick rather than incremented. A laptop that
	// sleeps stops firing the interval, and a self-incrementing counter would wake up
	// hours short; subtracting two instants cannot drift.
	let now = $state(Date.now());

	$effect(() => {
		if (!since) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const elapsed = $derived(since ? secondsSince(since, new Date(now)) : Math.max(0, seconds));
	const text = $derived(formatClock(elapsed));

	// An ISO 8601 duration, so the value is machine-readable as well as displayed.
	const iso = $derived(
		`PT${Math.floor(elapsed / 3600)}H${Math.floor(elapsed / 60) % 60}M${elapsed % 60}S`
	);
</script>

<!--
	Deliberately not a live region: announcing a new value every second would flood a
	screen reader. The surrounding status card names the state in text.
-->
<time datetime={iso} class="font-mono tabular-nums tracking-clock {sizes[size]} {extra}">
	{text}
</time>
