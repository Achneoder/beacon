<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { formatDuration, formatSignedDuration, type TimesheetWeek } from '@beacon/shared';
	import { Alert, Button, Card, StatTile } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { ClockPanel, SegmentRow } from '$lib/components/attendance';
	import { clock } from '$lib/attendance/clock.svelte';
	import { balanceTone } from '$lib/attendance/labels';
	import { getWeek } from '$lib/api/attendance';
	import { errorKey } from '$lib/auth/errors';

	let week = $state<TimesheetWeek | null>(null);
	let errorMessageKey = $state<string | null>(null);

	const today = $derived(clock.today);

	async function loadWeek() {
		try {
			week = await getWeek(0);
		} catch (error) {
			errorMessageKey = errorKey(error);
		}
	}

	// A clock action changes the week's totals as well as today's, so reload both.
	function onClockError(error: unknown) {
		errorMessageKey = errorKey(error);
	}

	// The layout keeps the clock fresh; the week is this page's own, for the tiles.
	// Reading `clock.state` makes the totals follow a clock-out immediately.
	$effect(() => {
		void clock.state;
		void loadWeek();
	});
</script>

<PageHeader kicker={$_('today.kicker')} title={$_('today.title')} />

{#if errorMessageKey}
	<Alert tone="warning" class="mt-6">{$_(errorMessageKey)}</Alert>
{/if}

{#if today}
	<div class="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
		<ClockPanel {today} onError={onClockError} />

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
			<StatTile
				label={$_('today.weekBalance')}
				value={formatSignedDuration(week?.balanceMinutes ?? 0)}
				tone={balanceTone(week?.balanceMinutes ?? 0)}
				hint={week
					? $_('today.weekWorked', {
							values: { worked: formatDuration(week.workedMinutes) }
						})
					: undefined}
			/>
			<StatTile
				label={$_('today.overtimeBank')}
				value={formatSignedDuration(week?.overtime.balanceMinutes ?? 0)}
				aside={week
					? $_('today.cap', {
							values: { cap: formatDuration(week.overtime.capMinutes) }
						})
					: undefined}
				tone={week?.overtime.overCap ? 'warning' : 'neutral'}
				hint={week?.overtime.overCap
					? $_('today.overCap', {
							values: { over: formatDuration(week.overtime.overCapMinutes) }
						})
					: undefined}
			/>
			<StatTile
				label={$_('today.breakTotal')}
				value={formatDuration(today.breakMinutes)}
				hint={$_('today.breakHint')}
			/>
		</div>
	</div>

	<Card variant="panel" as="section" class="mt-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-base font-bold tracking-tight">{$_('today.segments')}</h2>
			<Button variant="quiet" href="/timesheet">{$_('today.openTimesheet')}</Button>
		</div>

		{#if today.segments.length}
			<ul class="mt-2">
				{#each today.segments as segment (segment.id)}
					<SegmentRow {segment} timezone={today.timezone} />
				{/each}
			</ul>
		{:else}
			<p class="mt-3 text-sm text-ink-muted">{$_('today.noSegments')}</p>
		{/if}
	</Card>
{:else}
	<Card variant="panel" as="section" class="mt-6">
		<p class="text-sm text-ink-muted">{$_('today.loading')}</p>
	</Card>
{/if}
