<script lang="ts">
	import type { Tone } from './types';

	type Props = {
		tone?: Tone;
		/** Pulses while the state is live — clocked in, on break. */
		pulse?: boolean;
		size?: number;
		class?: string;
	};

	let { tone = 'neutral', pulse = false, size = 8, class: extra = '' }: Props = $props();

	const tones: Record<Tone, string> = {
		accent: 'bg-accent',
		success: 'bg-success',
		warning: 'bg-warning',
		info: 'bg-info',
		neutral: 'bg-ink-muted'
	};
</script>

<span
	aria-hidden="true"
	class="shrink-0 rounded-full {tones[tone]} {pulse ? 'animate-status-pulse' : ''} {extra}"
	style="width: {size}px; height: {size}px"
></span>
