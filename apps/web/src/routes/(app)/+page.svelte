<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { locale } from 'svelte-i18n';
	import {
		formatDays,
		formatDuration,
		formatSignedDuration,
		type AbsenceRequestSummary,
		type LeaveBalanceSummary,
		type TimesheetWeek
	} from '@beacon/shared';
	import { Alert, Button, Card, StatTile } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { ClockPanel, SegmentRow } from '$lib/components/attendance';
	import { clock } from '$lib/attendance/clock.svelte';
	import { balanceTone } from '$lib/attendance/labels';
	import { formatRange, typeName } from '$lib/absence/labels';
	import { getWeek } from '$lib/api/attendance';
	import { getLeaveBalance, listAbsences } from '$lib/api/absences';
	import { errorKey } from '$lib/auth/errors';

	let week = $state<TimesheetWeek | null>(null);
	let balance = $state<LeaveBalanceSummary | null>(null);
	let absences = $state<AbsenceRequestSummary[]>([]);
	let errorMessageKey = $state<string | null>(null);

	const today = $derived(clock.today);
	const lang = $derived($locale ?? 'en');
	const todayDate = $derived(today?.date ?? new Date().toISOString().slice(0, 10));

	/**
	 * The soonest absence that has not been lived yet, whether or not it has been
	 * decided — the card is a reminder, and a pending request is exactly what a
	 * person wants reminding of.
	 */
	const nextAbsence = $derived(
		absences
			.filter((absence) => absence.status !== 'rejected' && absence.endsOn >= todayDate)
			.sort((left, right) => left.startsOn.localeCompare(right.startsOn))[0] ?? null
	);

	async function loadWeek() {
		try {
			[week, balance, absences] = await Promise.all([
				getWeek(0),
				getLeaveBalance(),
				listAbsences({ mine: true })
			]);
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
				label={$_('today.holidayLeft')}
				value={balance ? formatDays(balance.remainingDays) : '—'}
				aside={$_('calendar.remaining')}
				tone="accent"
				hint={balance
					? $_('today.holidayLeftHint', {
							values: {
								taken: formatDays(balance.takenDays),
								entitlement: formatDays(balance.entitlementDays)
							}
						})
					: undefined}
			/>
			<StatTile
				label={$_('today.nextAbsence')}
				value={nextAbsence
					? typeName({ key: nextAbsence.typeKey, name: nextAbsence.typeName }, $_)
					: $_('today.noAbsence')}
				hint={nextAbsence ? formatRange(nextAbsence.startsOn, nextAbsence.endsOn, lang) : undefined}
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
			<div class="flex items-center gap-3">
				<Button variant="quiet" href="/calendar">{$_('today.openCalendar')}</Button>
				<Button variant="quiet" href="/timesheet">{$_('today.openTimesheet')}</Button>
			</div>
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
