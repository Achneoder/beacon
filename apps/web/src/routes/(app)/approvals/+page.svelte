<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { formatDuration, minutesBetween, type CorrectionSummary } from '@beacon/shared';
	import { Alert, Badge, Button, Card } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import {
		approvalKey,
		approvalTone,
		formatDayLabel,
		formatTimeRange
	} from '$lib/attendance/labels';
	import { approveCorrection, listCorrections, rejectCorrection } from '$lib/api/attendance';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';

	/**
	 * Undesigned in the canvas — every screen there is the employee's own view. Built
	 * from the same tokens and primitives as the rest, and worth taking back to the
	 * canvas alongside the other manager surfaces.
	 */
	let corrections = $state<CorrectionSummary[]>([]);
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);
	let decidingId = $state<string | null>(null);

	const canApprove = $derived(session.can('attendance:approve'));
	const lang = $derived($locale ?? 'en');
	// The user's own zone; a correction states instants, and a queue read in the wrong
	// zone would show the wrong hours.
	const timezone = $derived(session.user?.timezone ?? 'UTC');

	const pending = $derived(corrections.filter((item) => item.status === 'pending'));
	const decided = $derived(corrections.filter((item) => item.status !== 'pending'));

	$effect(() => {
		void load(canApprove);
	});

	async function load(approver: boolean) {
		loading = true;
		loadErrorKey = null;

		try {
			// An approver sees the queue; everyone else sees the requests they raised.
			corrections = await listCorrections(!approver);
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			loading = false;
		}
	}

	async function decide(id: string, approved: boolean) {
		decidingId = id;

		try {
			const updated = approved ? await approveCorrection(id) : await rejectCorrection(id);
			corrections = corrections.map((item) => (item.id === id ? updated : item));
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			decidingId = null;
		}
	}

	function hours(correction: CorrectionSummary): string {
		if (!correction.startedAt || !correction.endedAt) return '—';

		const worked = minutesBetween(correction.startedAt, correction.endedAt);

		return formatDuration(Math.max(0, worked - correction.breakMinutes));
	}

	function range(correction: CorrectionSummary): string {
		if (!correction.startedAt) return '—';

		return formatTimeRange(correction.startedAt, correction.endedAt, timezone, lang, '…');
	}
</script>

<PageHeader kicker={$_('approvals.kicker')} title={$_('approvals.title')} />

{#if loadErrorKey}
	<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
{/if}

<Card variant="panel" as="section" class="mt-6">
	<h2 class="text-base font-bold tracking-tight">
		{canApprove ? $_('approvals.queue') : $_('approvals.yours')}
	</h2>
	<p class="mt-1 text-2xs text-ink-muted">
		{canApprove ? $_('approvals.queueHint') : $_('approvals.yoursHint')}
	</p>

	{#if loading}
		<p class="mt-4 text-sm text-ink-muted">{$_('approvals.loading')}</p>
	{:else if pending.length === 0}
		<p class="mt-4 text-sm text-ink-muted">{$_('approvals.empty')}</p>
	{:else}
		<ul class="mt-4 flex flex-col gap-3">
			{#each pending as correction (correction.id)}
				<li class="rounded-card border border-border-default p-4">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<div class="min-w-0">
							<p class="text-sm font-semibold">
								{correction.requestedByName}
								<span class="ml-2 text-2xs font-normal text-ink-muted">
									{$_(`approvals.kind.${correction.kind}`)}
								</span>
							</p>
							<p class="mt-0.5 font-mono text-2xs text-ink-muted">
								{formatDayLabel(correction.date, lang)} · {range(correction)} · {hours(correction)}
							</p>
						</div>
						<Badge tone={approvalTone(correction.status)}>
							{$_(approvalKey(correction.status))}
						</Badge>
					</div>

					<p class="mt-2 text-sm text-ink-muted">{correction.reason}</p>

					{#if canApprove}
						<div class="mt-3 flex gap-2">
							<Button
								size="sm"
								variant="primary"
								tone="success"
								disabled={decidingId === correction.id}
								onclick={() => decide(correction.id, true)}
							>
								{$_('approvals.approve')}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={decidingId === correction.id}
								onclick={() => decide(correction.id, false)}
							>
								{$_('approvals.reject')}
							</Button>
						</div>
					{:else if correction.approverName}
						<p class="mt-2 text-2xs text-ink-muted">
							{$_('approvals.awaiting', { values: { name: correction.approverName } })}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>

{#if decided.length}
	<Card variant="panel" as="section" class="mt-4">
		<h2 class="text-base font-bold tracking-tight">{$_('approvals.decided')}</h2>
		<ul class="mt-3">
			{#each decided as correction (correction.id)}
				<li
					class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-3 last:border-b-0"
				>
					<span class="font-mono text-2xs text-ink-muted">
						{formatDayLabel(correction.date, lang)}
					</span>
					<span class="text-sm">{correction.requestedByName}</span>
					<span class="min-w-0 flex-1 truncate text-2xs text-ink-muted">{correction.reason}</span>
					<Badge tone={approvalTone(correction.status)}>
						{$_(approvalKey(correction.status))}
					</Badge>
				</li>
			{/each}
		</ul>
	</Card>
{/if}
