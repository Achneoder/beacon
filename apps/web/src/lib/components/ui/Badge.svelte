<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Tone } from './types';

	type Props = {
		children: Snippet;
		tone?: Tone;
		class?: string;
	};

	let { children, tone = 'neutral', class: extra = '' }: Props = $props();

	const tones: Record<Tone, string> = {
		accent: 'bg-accent-soft text-accent-on-soft',
		success: 'bg-success-soft text-success',
		warning: 'bg-warning-soft text-warning',
		info: 'bg-info-soft text-info',
		neutral: 'bg-border-subtle text-ink-muted'
	};
</script>

<span
	class="inline-flex items-center rounded-full px-2.5 py-0.5 text-eyebrow font-bold whitespace-nowrap {tones[
		tone
	]} {extra}"
>
	{@render children()}
</span>
