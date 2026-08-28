<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { type ClockState, isRunning } from '@beacon/shared';
	import type { Tone } from '$lib/components/ui/types';
	import { Card, Clock, StatusDot } from '$lib/components/ui';

	type Props = {
		state: ClockState;
		/** When the current state began — the clock runs from it. */
		since?: string | Date | null;
	};

	let { state, since = null }: Props = $props();

	const tones: Record<ClockState, Tone> = {
		in: 'success',
		break: 'warning',
		out: 'neutral'
	};
</script>

<Card variant="tile" class="px-4 py-3">
	<div class="flex items-center gap-2">
		<StatusDot tone={tones[state]} pulse={isRunning(state)} />
		<span class="text-2xs font-semibold text-ink">{$_(`shell.status.${state}`)}</span>
	</div>
	<Clock {since} size="sm" class="mt-1.5 block text-ink-muted" />
</Card>
