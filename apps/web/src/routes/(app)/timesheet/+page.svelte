<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import {
		formatDuration,
		formatSignedDuration,
		type CreateCorrectionRequest,
		type TimesheetWeek
	} from '@beacon/shared';
	import { Alert, Badge, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import {
		balanceTone,
		formatDayLabel,
		formatLockMoment,
		formatTimeOfDay,
		weekdayKey
	} from '$lib/attendance/labels';
	import { getWeek, requestCorrection } from '$lib/api/attendance';
	import { errorKey } from '$lib/auth/errors';

	let offset = $state(0);
	let week = $state<TimesheetWeek | null>(null);
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);

	const lang = $derived($locale ?? 'en');
	const todayDate = $derived(new Date().toISOString().slice(0, 10));
	// The day a fresh request defaults to — the Monday of whichever week is on screen.
	const weekStart = $derived(week?.from ?? '');
	/**
	 * Whether the organization lets a person's own correction through without an
	 * approval. It only changes what this screen *says*: the API decides what a
	 * correction does, so the form is the same form either way and nothing here is
	 * load-bearing for authorization.
	 */
	const selfApproves = $derived(week?.selfApproveCorrections ?? false);

	$effect(() => {
		void load(offset);
	});

	async function load(at: number) {
		loading = true;
		loadErrorKey = null;

		try {
			week = await getWeek(at);
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			loading = false;
		}
	}

	function time(instant: string | null): string {
		return (week && formatTimeOfDay(instant, week.timezone, lang)) || '—';
	}

	// ── The correction request ───────────────────────────────────────────────────
	let requesting = $state(false);
	let requestDate = $state('');
	let requestStart = $state('09:00');
	let requestEnd = $state('17:00');
	let requestBreak = $state('30');
	let requestReason = $state('');
	let sending = $state(false);
	let requestErrorKey = $state<string | null>(null);
	let sent = $state(false);

	/** The day the correction form is currently editing, if the week has loaded it. */
	const requestDay = $derived(week?.days.find((day) => day.date === requestDate) ?? null);

	/**
	 * Loads the form's start/end/break from the day already on the books, so
	 * correcting a tracked day edits what actually happened instead of overwriting it
	 * from the form's blank-day defaults.
	 */
	function prefillFor(date: string) {
		const day = week?.days.find((entry) => entry.date === date) ?? null;

		if (week && day?.startedAt && day.endedAt) {
			requestStart = formatTimeOfDay(day.startedAt, week.timezone, lang) ?? requestStart;
			requestEnd = formatTimeOfDay(day.endedAt, week.timezone, lang) ?? requestEnd;
			requestBreak = String(day.breakMinutes);
		} else {
			requestStart = '09:00';
			requestEnd = '17:00';
			requestBreak = '30';
		}
	}

	function openRequest(date: string) {
		requesting = true;
		requestDate = date;
		requestReason = '';
		requestErrorKey = null;
		sent = false;
		prefillFor(date);
	}

	function pickDate(date: string) {
		requestDate = date;
		prefillFor(date);
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();

		if (!requestDate || requestReason.trim().length < 3) {
			requestErrorKey = 'errors.checkFields';
			return;
		}

		sending = true;
		requestErrorKey = null;

		try {
			// A day that already has its one entry is amended, not duplicated — see
			// `TimesheetDay.entryId`. Only a day with no entry (or an ambiguous one with
			// more than one) still adds a fresh one.
			const entryId = requestDay?.entryId ?? null;

			// The times are the user's own wall clock; the browser's offset turns them
			// into the instants the API stores.
			await requestCorrection({
				kind: entryId ? 'amend' : 'add',
				entryId,
				startedAt: new Date(`${requestDate}T${requestStart}`).toISOString(),
				endedAt: new Date(`${requestDate}T${requestEnd}`).toISOString(),
				breakMinutes: Number(requestBreak) || 0,
				reason: requestReason.trim()
			} satisfies CreateCorrectionRequest);

			sent = true;
			requesting = false;
			await load(offset);
		} catch (error) {
			requestErrorKey = errorKey(error);
		} finally {
			sending = false;
		}
	}
</script>

<PageHeader kicker={$_('timesheet.kicker')} title={$_('timesheet.title')} />

<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
	<div class="flex items-center gap-2">
		<Button size="sm" variant="ghost" onclick={() => (offset -= 1)}>
			{$_('timesheet.previous')}
		</Button>
		<Button size="sm" variant="ghost" disabled={offset >= 0} onclick={() => (offset += 1)}>
			{$_('timesheet.next')}
		</Button>
		{#if offset !== 0}
			<Button size="sm" variant="quiet" onclick={() => (offset = 0)}>
				{$_('timesheet.thisWeek')}
			</Button>
		{/if}
	</div>

	{#if week}
		<p class="font-mono text-2xs text-ink-muted">
			{formatDayLabel(week.from, lang)} – {formatDayLabel(week.to, lang)}
		</p>
	{/if}
</div>

{#if loadErrorKey}
	<Alert tone="warning" class="mt-4">{$_(loadErrorKey)}</Alert>
{/if}

{#if sent}
	<Alert tone="success" class="mt-4">
		{selfApproves ? $_('timesheet.correctionApplied') : $_('timesheet.requestSent')}
	</Alert>
{/if}

{#if week}
	<Card variant="panel" as="section" class="mt-4 overflow-x-auto">
		<table class="w-full min-w-[46rem] border-collapse text-sm">
			<caption class="sr-only">{$_('timesheet.caption')}</caption>
			<thead>
				<tr class="border-b border-border-default text-left text-2xs text-ink-muted">
					<th scope="col" class="py-2 pr-3 font-semibold">{$_('timesheet.day')}</th>
					<th scope="col" class="py-2 pr-3 font-semibold">{$_('timesheet.start')}</th>
					<th scope="col" class="py-2 pr-3 font-semibold">{$_('timesheet.end')}</th>
					<th scope="col" class="py-2 pr-3 font-semibold">{$_('timesheet.break')}</th>
					<th scope="col" class="py-2 pr-3 font-semibold">{$_('timesheet.worked')}</th>
					<th scope="col" class="py-2 font-semibold">{$_('timesheet.balance')}</th>
				</tr>
			</thead>
			<tbody>
				{#each week.days as day (day.date)}
					<tr
						class="border-b border-border-subtle last:border-b-0
						       {day.date === todayDate ? 'bg-accent-soft/40' : ''}"
					>
						<th scope="row" class="py-3 pr-3 text-left font-semibold">
							<span>{$_(weekdayKey(day.weekday))}</span>
							<span class="ml-2 font-mono text-2xs font-normal text-ink-muted">
								{formatDayLabel(day.date, lang)}
							</span>
							{#if day.holiday}
								<Badge tone="neutral" class="ml-2">{day.holiday}</Badge>
							{:else if day.absenceTag}
								<Badge tone="info" class="ml-2">{day.absenceTag}</Badge>
							{/if}
							{#if day.hasPendingCorrection}
								<Badge tone="warning" class="ml-2">{$_('timesheet.pending')}</Badge>
							{/if}
						</th>
						<td class="py-3 pr-3 font-mono tabular-nums">{time(day.startedAt)}</td>
						<td class="py-3 pr-3 font-mono tabular-nums">{time(day.endedAt)}</td>
						<td class="py-3 pr-3 font-mono tabular-nums text-ink-muted">
							{formatDuration(day.breakMinutes)}
						</td>
						<td class="py-3 pr-3 font-mono tabular-nums">{formatDuration(day.workedMinutes)}</td>
						<td class="py-3 font-mono tabular-nums">
							{#if day.credited}
								<span class="text-info">{$_('timesheet.credited')}</span>
							{:else}
								<span
									class={day.balanceMinutes > 0
										? 'text-success'
										: day.balanceMinutes < 0
											? 'text-warning'
											: 'text-ink-muted'}
								>
									{formatSignedDuration(day.balanceMinutes)}
								</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t-2 border-border-default font-semibold">
					<th scope="row" class="py-3 pr-3 text-left">{$_('timesheet.total')}</th>
					<td colspan="2"></td>
					<td class="py-3 pr-3 font-mono tabular-nums text-ink-muted">
						{formatDuration(week.breakMinutes)}
					</td>
					<td class="py-3 pr-3 font-mono tabular-nums">{formatDuration(week.workedMinutes)}</td>
					<td
						class="py-3 font-mono tabular-nums {balanceTone(week.balanceMinutes) === 'success'
							? 'text-success'
							: balanceTone(week.balanceMinutes) === 'warning'
								? 'text-warning'
								: ''}"
					>
						{formatSignedDuration(week.balanceMinutes)}
					</td>
				</tr>
			</tfoot>
		</table>
	</Card>

	<Card variant="card" class="mt-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-2xs text-ink-muted">
				{#if week.locked && selfApproves}
					{$_('timesheet.lockedSelfApprove')}
				{:else if week.locked}
					{$_('timesheet.locked')}
				{:else}
					{$_('timesheet.unlockedUntil', {
						values: { moment: formatLockMoment(week.locksAt, week.timezone, lang) }
					})}
				{/if}
			</p>
			<Button size="sm" onclick={() => openRequest(weekStart)}>
				{selfApproves ? $_('timesheet.correctDay') : $_('timesheet.requestCorrection')}
			</Button>
		</div>
	</Card>

	{#if requesting}
		<Card variant="panel" as="section" class="mt-4">
			<h2 class="text-base font-bold tracking-tight">
				{selfApproves ? $_('timesheet.correctTitle') : $_('timesheet.requestTitle')}
			</h2>
			<p class="mt-1 text-2xs text-ink-muted">
				{selfApproves ? $_('timesheet.correctHint') : $_('timesheet.requestHint')}
			</p>

			<form class="mt-4 grid gap-4 sm:grid-cols-2" onsubmit={send}>
				<label class="flex flex-col gap-1.5 text-sm font-semibold">
					{$_('timesheet.date')}
					<input
						type="date"
						value={requestDate}
						oninput={(event) => pickDate((event.currentTarget as HTMLInputElement).value)}
						min={week.from}
						max={week.to}
						required
						class="rounded-control border border-border-default bg-surface px-3 py-2 font-mono text-sm font-normal"
					/>
				</label>

				<label class="flex flex-col gap-1.5 text-sm font-semibold">
					{$_('timesheet.breakMinutes')}
					<input
						type="number"
						bind:value={requestBreak}
						min="0"
						max="1440"
						class="rounded-control border border-border-default bg-surface px-3 py-2 font-mono text-sm font-normal"
					/>
				</label>

				<label class="flex flex-col gap-1.5 text-sm font-semibold">
					{$_('timesheet.start')}
					<input
						type="time"
						bind:value={requestStart}
						required
						class="rounded-control border border-border-default bg-surface px-3 py-2 font-mono text-sm font-normal"
					/>
				</label>

				<label class="flex flex-col gap-1.5 text-sm font-semibold">
					{$_('timesheet.end')}
					<input
						type="time"
						bind:value={requestEnd}
						required
						class="rounded-control border border-border-default bg-surface px-3 py-2 font-mono text-sm font-normal"
					/>
				</label>

				<div class="sm:col-span-2">
					<TextField
						id="correction-reason"
						label={$_('timesheet.reason')}
						hint={selfApproves ? $_('timesheet.reasonHintSelf') : $_('timesheet.reasonHint')}
						bind:value={requestReason}
						required
					/>
				</div>

				{#if requestErrorKey}
					<div class="sm:col-span-2"><Alert tone="warning">{$_(requestErrorKey)}</Alert></div>
				{/if}

				<div class="flex gap-2 sm:col-span-2">
					<Button type="submit" variant="primary" disabled={sending}>
						{#if selfApproves}
							{sending ? $_('timesheet.applying') : $_('timesheet.apply')}
						{:else}
							{sending ? $_('timesheet.sending') : $_('timesheet.send')}
						{/if}
					</Button>
					<Button variant="ghost" onclick={() => (requesting = false)}>
						{$_('timesheet.cancel')}
					</Button>
				</div>
			</form>
		</Card>
	{/if}
{:else if loading}
	<Card variant="panel" as="section" class="mt-4">
		<p class="text-sm text-ink-muted">{$_('timesheet.loading')}</p>
	</Card>
{/if}
