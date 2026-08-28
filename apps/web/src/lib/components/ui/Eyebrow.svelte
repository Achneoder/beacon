<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		children: Snippet;
		/** `accent` for the emphasised label on an accent card. */
		tone?: 'muted' | 'accent';
		class?: string;
	};

	let { children, tone = 'muted', class: extra = '' }: Props = $props();

	const tones = {
		muted: 'text-ink-muted font-semibold',
		accent: 'text-accent-on-soft font-bold'
	} as const;
</script>

<div class="text-eyebrow tracking-eyebrow uppercase {tones[tone]} {extra}">
	{@render children()}
</div>
