<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { formatDuration, type AbsenceRequestSummary } from '@beacon/shared';
	import { Badge, Button } from '$lib/components/ui';
	import { formatRange, statusKey, statusTone, typeName } from '$lib/absence/labels';

	/** One row of the request list, on the calendar and in the approval queue alike. */
	type Props = {
		absence: AbsenceRequestSummary;
		/** Shown only while the request is still a question, and only for its owner. */
		onWithdraw?: (id: string) => void;
		/** Whose request it is — the queue names the person, your own list does not. */
		showName?: boolean;
		busy?: boolean;
		children?: import('svelte').Snippet;
	};

	let { absence, onWithdraw, showName = false, busy = false, children }: Props = $props();

	const lang = $derived($locale ?? 'en');
	const label = $derived(typeName({ key: absence.typeKey, name: absence.typeName }, $_));
	// A type that costs no quota reports the working days it covers instead — a week
	// of home office is still a week, it just is not deducted from anything.
	const days = $derived(absence.costDays > 0 ? absence.costDays : absence.workingDays);
	// Time off in lieu is still counted in days like everything else — the hours are
	// what it *costs*, and naming the purse is the whole point of showing them: the
	// day is off the overtime bank, not off the holiday quota.
	const overtime = $derived(absence.costMinutes > 0 ? formatDuration(absence.costMinutes) : null);
</script>

<li class="rounded-card border border-border-default p-4">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<div class="min-w-0">
			<p class="text-sm font-semibold">
				{#if showName}{absence.userName} ·
				{/if}{label}
				{#if absence.halfDayStart || absence.halfDayEnd}
					<span class="ml-1 text-2xs font-normal text-ink-muted">{$_('absence.halfDay')}</span>
				{/if}
			</p>
			<p class="mt-0.5 font-mono text-2xs text-ink-muted">
				{formatRange(absence.startsOn, absence.endsOn, lang)} · {$_('absence.days', {
					values: { count: days }
				})}{#if overtime}
					· {$_('absence.fromOvertime', { values: { hours: overtime } })}
				{/if}
			</p>
		</div>
		<Badge tone={statusTone(absence.status)}>{$_(statusKey(absence.status))}</Badge>
	</div>

	{#if absence.note}
		<p class="mt-2 text-sm text-ink-muted">{absence.note}</p>
	{/if}

	{#if children}
		<div class="mt-3 flex gap-2">{@render children()}</div>
	{:else if absence.status === 'pending'}
		<div class="mt-3 flex flex-wrap items-center gap-3">
			{#if onWithdraw}
				<Button size="sm" variant="ghost" disabled={busy} onclick={() => onWithdraw(absence.id)}>
					{$_('calendar.withdraw')}
				</Button>
			{/if}
			{#if absence.approverName}
				<span class="text-2xs text-ink-muted">
					{$_('calendar.awaiting', { values: { name: absence.approverName } })}
				</span>
			{/if}
		</div>
	{:else if absence.decisionNote}
		<p class="mt-2 text-2xs text-ink-muted">{absence.decisionNote}</p>
	{/if}
</li>
