<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { formatDays, type LeaveBalanceSummary } from '@beacon/shared';
	import { Card } from '$lib/components/ui';
	import { formatDate } from '$lib/absence/labels';

	/** The right column's quota panel: what was granted, what is spent, what is left. */
	type Props = { balance: LeaveBalanceSummary };

	let { balance }: Props = $props();

	const lang = $derived($locale ?? 'en');

	const rows = $derived([
		{ key: 'calendar.entitlement', value: balance.entitlementDays },
		{ key: 'calendar.carryOver', value: balance.carryOverDays },
		{ key: 'calendar.taken', value: balance.takenDays },
		{ key: 'calendar.pendingDays', value: balance.pendingDays }
	]);
</script>

<Card variant="card">
	<div class="flex items-baseline justify-between gap-3">
		<h2 class="text-base font-bold tracking-tight">{$_('calendar.balance')}</h2>
		<span class="font-mono text-2xs text-ink-muted">{balance.year}</span>
	</div>

	<p class="mt-2 font-mono text-2xl text-accent-on-soft">
		{$_('absence.days', { values: { count: balance.remainingDays } })}
	</p>
	<p class="text-2xs text-ink-muted">{$_('calendar.remaining')}</p>

	<dl class="mt-3 flex flex-col gap-1.5">
		{#each rows as row (row.key)}
			<div class="flex items-baseline justify-between gap-3 text-2xs">
				<dt class="text-ink-muted">{$_(row.key)}</dt>
				<dd class="font-mono">{formatDays(row.value)}</dd>
			</div>
		{/each}
	</dl>

	{#if balance.carryOverDays > 0 && balance.carryOverExpiresOn}
		<p class="mt-2 text-2xs text-ink-muted">
			{$_('calendar.carryOverExpires', {
				values: { date: formatDate(balance.carryOverExpiresOn, lang) }
			})}
		</p>
	{/if}
</Card>
