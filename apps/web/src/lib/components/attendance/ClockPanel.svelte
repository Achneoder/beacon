<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { dayProgress, formatDuration, isRunning, type TodayStatus } from '@beacon/shared';
	import { Button, Card, Clock, ProgressBar, StatusDot } from '$lib/components/ui';
	import type { Tone } from '$lib/components/ui/types';
	import { clock } from '$lib/attendance/clock.svelte';
	import { clockStateKey } from '$lib/attendance/labels';

	type Props = {
		today: TodayStatus;
		/** Surfaced by the page, so a refused clock call is not swallowed. */
		onError: (error: unknown) => void;
	};

	let { today, onError }: Props = $props();

	const tones: Record<string, Tone> = { in: 'success', break: 'warning', out: 'neutral' };
	const tone = $derived(tones[today.state] ?? 'neutral');

	const progress = $derived(dayProgress(today.workedMinutes, today.targetMinutes));
	const worked = $derived(formatDuration(today.workedMinutes));
	const target = $derived(formatDuration(today.targetMinutes));

	async function run(action: () => Promise<void>) {
		try {
			await action();
		} catch (error) {
			onError(error);
		}
	}
</script>

<Card variant="panel" as="section">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<div class="flex items-center gap-2">
				<StatusDot {tone} pulse={isRunning(today.state)} />
				<span class="text-2xs font-semibold text-ink-muted">
					{$_(clockStateKey(today.state))}
				</span>
			</div>
			<!--
				Ticks from the server's `since` while running; shows the day's total once
				the clock stops, so the panel never reads 00:00:00 after a full day.
			-->
			<Clock since={today.since} seconds={today.workedMinutes * 60} size="lg" class="mt-2 block" />
			<p class="mt-1 text-2xs text-ink-muted">
				{$_('today.workedOfTarget', { values: { worked, target } })}
			</p>
		</div>

		<div class="flex flex-wrap gap-2" role="group" aria-label={$_('today.controls')}>
			{#if today.state === 'out'}
				<Button
					variant="primary"
					tone="success"
					disabled={clock.pending}
					onclick={() => run(clock.clockIn)}
				>
					{$_('today.clockIn')}
				</Button>
				<Button variant="ghost" href="/timesheet">{$_('today.addManual')}</Button>
			{:else if today.state === 'in'}
				<Button variant="primary" disabled={clock.pending} onclick={() => run(clock.clockOut)}>
					{$_('today.clockOut')}
				</Button>
				<Button variant="ghost" disabled={clock.pending} onclick={() => run(clock.startBreak)}>
					{$_('today.startBreak')}
				</Button>
			{:else}
				<Button
					variant="primary"
					tone="success"
					disabled={clock.pending}
					onclick={() => run(clock.stopBreak)}
				>
					{$_('today.resumeWork')}
				</Button>
				<Button variant="ghost" disabled={clock.pending} onclick={() => run(clock.clockOut)}>
					{$_('today.clockOut')}
				</Button>
			{/if}
		</div>
	</div>

	<ProgressBar
		class="mt-6"
		value={progress * 100}
		{tone}
		label={$_('today.dayProgress')}
		valueText={$_('today.workedOfTarget', { values: { worked, target } })}
	/>
</Card>
