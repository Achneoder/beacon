<script lang="ts">
	import type { Tone } from './types';

	type Props = {
		/** Progress in the range 0–`max`; clamped for display. */
		value: number;
		max?: number;
		tone?: Tone;
		/** Accessible name — required, since the bar carries no visible label. */
		label: string;
		/** Human-readable value read out instead of the raw number, e.g. "3:47 of 6:00". */
		valueText?: string;
		size?: 'sm' | 'md';
		class?: string;
	};

	let {
		value,
		max = 100,
		tone = 'accent',
		label,
		valueText,
		size = 'md',
		class: extra = ''
	}: Props = $props();

	const tones: Record<Tone, string> = {
		accent: 'bg-accent',
		success: 'bg-success',
		warning: 'bg-warning',
		info: 'bg-info',
		neutral: 'bg-ink-muted'
	};

	const pct = $derived(max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);
</script>

<div
	role="progressbar"
	aria-label={label}
	aria-valuenow={value}
	aria-valuemin={0}
	aria-valuemax={max}
	aria-valuetext={valueText}
	class="overflow-hidden rounded-full bg-border-subtle {size === 'sm' ? 'h-1.5' : 'h-2'} {extra}"
>
	<div class="h-full rounded-full {tones[tone]}" style="width: {pct}%"></div>
</div>
