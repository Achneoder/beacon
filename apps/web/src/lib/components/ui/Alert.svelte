<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Tone } from './types';

	type Props = {
		children: Snippet;
		tone?: Tone;
		/**
		 * `alert` interrupts the screen reader immediately — right for a failed submit,
		 * wrong for a message that was on the page all along. `status` is the polite
		 * counterpart; `none` suppresses the live region entirely.
		 */
		live?: 'alert' | 'status' | 'none';
		class?: string;
	};

	let { children, tone = 'warning', live = 'alert', class: extra = '' }: Props = $props();

	const tones: Record<Tone, string> = {
		accent: 'bg-accent-soft text-accent-on-soft',
		success: 'bg-success-soft text-success',
		warning: 'bg-warning-soft text-warning',
		info: 'bg-info-soft text-info',
		neutral: 'bg-surface-muted text-ink'
	};
</script>

<div
	role={live === 'none' ? undefined : live}
	class="rounded-tile px-4 py-3 text-sm font-medium {tones[tone]} {extra}"
>
	{@render children()}
</div>
