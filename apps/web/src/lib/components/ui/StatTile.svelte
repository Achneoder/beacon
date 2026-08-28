<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from './Card.svelte';
	import type { Tone } from './types';

	type Props = {
		/** Localised label. */
		label: string;
		/** Localised, pre-formatted value — durations render in the mono face. */
		value: string;
		/** Localised supporting line under the value. */
		hint?: string;
		/** Small right-aligned note next to the label. */
		aside?: string;
		tone?: Tone;
		/** Trailing content, e.g. a `ProgressBar`. */
		footer?: Snippet;
		class?: string;
	};

	let { label, value, hint, aside, tone = 'neutral', footer, class: extra = '' }: Props = $props();

	const tones: Record<Tone, string> = {
		accent: 'text-accent-on-soft',
		success: 'text-success',
		warning: 'text-warning',
		info: 'text-info',
		neutral: 'text-ink'
	};
</script>

<Card variant="tile" class={extra}>
	<div class="flex items-baseline justify-between gap-3">
		<span class="text-2xs font-semibold text-ink-muted">{label}</span>
		{#if aside}<span class="text-2xs text-ink-muted">{aside}</span>{/if}
	</div>
	<p class="mt-1.5 font-mono text-2xl {tones[tone]}">{value}</p>
	{#if hint}<p class="mt-0.5 text-2xs text-ink-muted">{hint}</p>{/if}
	{#if footer}<div class="mt-3">{@render footer()}</div>{/if}
</Card>
