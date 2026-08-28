<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import {
		absenceCostDays,
		formatDays,
		type AbsenceCalendar,
		type AbsenceRequestSummary,
		type AbsenceTypeSummary,
		type LeaveBalanceSummary
	} from '@beacon/shared';
	import { Alert, Badge, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { BalanceCard, MonthGrid, RequestRow } from '$lib/components/absence';
	import {
		cellTint,
		formatMonth,
		formatRange,
		gridRange,
		monthOf,
		shiftMonth,
		typeName
	} from '$lib/absence/labels';
	import {
		createAbsence,
		getCalendar,
		getLeaveBalance,
		listAbsences,
		listAbsenceTypes,
		withdrawAbsence
	} from '$lib/api/absences';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';

	/**
	 * The calendar screen: a six-row month grid, a two-click range selection that
	 * reveals the request card inline, and the request list beneath it.
	 *
	 * The cost of a selection is computed in the browser from the same shared
	 * arithmetic the API uses, so `5 days · Vacation` is on screen before anything is
	 * sent — and the figure the server freezes onto the row still governs the quota.
	 */
	let month = $state(new Date().toISOString().slice(0, 7));
	let calendar = $state<AbsenceCalendar | null>(null);
	let types = $state<AbsenceTypeSummary[]>([]);
	let balance = $state<LeaveBalanceSummary | null>(null);
	let requests = $state<AbsenceRequestSummary[]>([]);
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);
	let notice = $state<string | null>(null);

	const lang = $derived($locale ?? 'en');
	const today = $derived(new Date().toISOString().slice(0, 10));
	const canSeeTeam = $derived(session.can('holiday:approve'));

	/** Whose days the grid shows. Narrow by default — a calendar leaks sick leave. */
	const SCOPES = ['me', 'team', 'organization'] as const;
	type Scope = (typeof SCOPES)[number];

	let scope = $state<Scope>('me');

	const holidayDates = $derived(calendar?.holidays.map((holiday) => holiday.date) ?? []);
	// Only the types actually in use are worth a legend entry.
	const legend = $derived(types.filter((type) => type.active));

	$effect(() => {
		void load(month, scope);
	});

	async function load(forMonth: string, forScope: Scope) {
		loading = true;
		loadErrorKey = null;
		const { from, to } = gridRange(forMonth);

		try {
			[calendar, types, balance, requests] = await Promise.all([
				getCalendar(from, to, forScope),
				listAbsenceTypes(),
				getLeaveBalance(),
				listAbsences({ mine: true })
			]);
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			loading = false;
		}
	}

	// ── The request ──────────────────────────────────────────────────────────────
	let typeId = $state('');
	let note = $state('');
	let halfDayStart = $state(false);
	let halfDayEnd = $state(false);
	let sending = $state(false);
	let requestErrorKey = $state<string | null>(null);
	let busyId = $state<string | null>(null);

	// ── The two-click range selection ────────────────────────────────────────────
	let selection = $state<{ from: string; to: string | null } | null>(null);

	/**
	 * First click sets the start, second the end, third starts over. Clicking a day
	 * before the start is not an error — the pair is ordered when it is read, so a
	 * backwards drag simply selects backwards.
	 */
	function pick(date: string) {
		if (!selection || selection.to !== null) {
			selection = { from: date, to: null };
			notice = null;
			return;
		}

		selection =
			date < selection.from
				? { from: date, to: selection.from }
				: { from: selection.from, to: date };
	}

	const range = $derived(selection?.to ? { startsOn: selection.from, endsOn: selection.to } : null);
	const cost = $derived(
		range ? absenceCostDays({ ...range, halfDayStart, halfDayEnd }, holidayDates) : 0
	);

	// The first type is the sensible default — `vacation` is seeded at position 0.
	$effect(() => {
		if (!typeId && legend.length) typeId = legend[0].id;
	});

	function reset() {
		selection = null;
		note = '';
		halfDayStart = false;
		halfDayEnd = false;
		requestErrorKey = null;
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!range || !typeId) return;

		sending = true;
		requestErrorKey = null;

		try {
			await createAbsence({
				typeId,
				startsOn: range.startsOn,
				endsOn: range.endsOn,
				halfDayStart,
				halfDayEnd,
				note: note.trim() || null
			});

			reset();
			notice = 'calendar.requestSent';
			await load(month, scope);
		} catch (error) {
			requestErrorKey = errorKey(error);
		} finally {
			sending = false;
		}
	}

	async function withdraw(id: string) {
		busyId = id;

		try {
			await withdrawAbsence(id);
			notice = 'calendar.withdrawn';
			await load(month, scope);
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			busyId = null;
		}
	}
</script>

<PageHeader kicker={$_('calendar.kicker')} title={$_('calendar.title')} />

<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
	<div class="flex items-center gap-2">
		<Button size="sm" variant="ghost" onclick={() => (month = shiftMonth(month, -1))}>
			{$_('calendar.previous')}
		</Button>
		<Button size="sm" variant="ghost" onclick={() => (month = shiftMonth(month, 1))}>
			{$_('calendar.next')}
		</Button>
		{#if month !== monthOf(today)}
			<Button size="sm" variant="quiet" onclick={() => (month = monthOf(today))}>
				{$_('calendar.thisMonth')}
			</Button>
		{/if}
		<p class="ml-1 text-sm font-bold tracking-tight">{formatMonth(month, lang)}</p>
	</div>

	{#if canSeeTeam}
		<div class="flex items-center gap-1">
			{#each SCOPES as option (option)}
				<Button
					size="sm"
					variant={scope === option ? 'primary' : 'ghost'}
					onclick={() => (scope = option)}
				>
					{$_(`calendar.scope.${option}`)}
				</Button>
			{/each}
		</div>
	{/if}
</div>

{#if loadErrorKey}
	<Alert tone="warning" class="mt-4">{$_(loadErrorKey)}</Alert>
{/if}

{#if notice}
	<Alert tone="success" class="mt-4">{$_(notice)}</Alert>
{/if}

<div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
	<div class="flex flex-col gap-4">
		<Card variant="panel" as="section">
			{#if calendar}
				<MonthGrid days={calendar.days} {month} {today} {selection} onPick={pick} />

				<p class="mt-3 text-2xs text-ink-muted">
					{#if !selection}
						{$_('calendar.selectStart')}
					{:else if !selection.to}
						{$_('calendar.selectEnd')}
					{:else}
						{$_('calendar.selected', {
							values: {
								range: formatRange(selection.from, selection.to, lang),
								cost: $_('absence.days', { values: { count: cost } })
							}
						})}
					{/if}
				</p>

				<!-- The legend sits under the grid, as the canvas draws it. -->
				<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
					<span class="text-2xs font-semibold text-ink-muted">{$_('calendar.legend')}</span>
					{#each legend as type (type.id)}
						<span
							class="rounded-full px-2.5 py-0.5 text-2xs font-semibold {cellTint(type.colorRole)}"
						>
							{typeName(type, $_)}
						</span>
					{/each}
					<span class="rounded-full bg-border-subtle px-2.5 py-0.5 text-2xs text-ink-muted">
						{$_('calendar.holiday')}
					</span>
				</div>
			{:else if loading}
				<p class="text-sm text-ink-muted">{$_('calendar.loading')}</p>
			{/if}
		</Card>

		{#if range}
			<Card variant="panel" as="section">
				<h2 class="text-base font-bold tracking-tight">{$_('calendar.newRequest')}</h2>
				<p class="mt-1 font-mono text-2xs text-ink-muted">
					{formatRange(range.startsOn, range.endsOn, lang)} · {formatDays(cost)}
				</p>

				<form class="mt-4 flex flex-col gap-4" onsubmit={send}>
					<label class="flex flex-col gap-1.5 text-sm font-semibold">
						{$_('calendar.type')}
						<select
							bind:value={typeId}
							class="rounded-control border border-border-default bg-surface px-3 py-2 text-sm font-normal"
						>
							{#each legend as type (type.id)}
								<option value={type.id}>{typeName(type, $_)}</option>
							{/each}
						</select>
					</label>

					<div class="flex flex-wrap gap-4">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={halfDayStart} />
							{$_('calendar.halfDayStart')}
						</label>
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={halfDayEnd} />
							{$_('calendar.halfDayEnd')}
						</label>
					</div>

					<TextField
						id="absence-note"
						label={$_('calendar.note')}
						hint={$_('calendar.noteHint')}
						bind:value={note}
					/>

					{#if requestErrorKey}
						<Alert tone="warning">{$_(requestErrorKey)}</Alert>
					{/if}

					<div class="flex gap-2">
						<Button type="submit" variant="primary" disabled={sending || !typeId}>
							{sending ? $_('calendar.sending') : $_('calendar.send')}
						</Button>
						<Button variant="ghost" onclick={reset}>{$_('calendar.cancel')}</Button>
					</div>
				</form>
			</Card>
		{/if}

		<Card variant="panel" as="section">
			<h2 class="text-base font-bold tracking-tight">{$_('calendar.requests')}</h2>

			{#if requests.length}
				<ul class="mt-3 flex flex-col gap-3">
					{#each requests as absence (absence.id)}
						<RequestRow {absence} onWithdraw={withdraw} busy={busyId === absence.id} />
					{/each}
				</ul>
			{:else}
				<p class="mt-3 text-sm text-ink-muted">{$_('calendar.requestsEmpty')}</p>
			{/if}
		</Card>
	</div>

	<div class="flex flex-col gap-4">
		{#if balance}
			<BalanceCard {balance} />
		{/if}

		{#if calendar?.holidays.length}
			<Card variant="card">
				<h2 class="text-base font-bold tracking-tight">{$_('calendar.holiday')}</h2>
				<ul class="mt-2 flex flex-col gap-1.5">
					{#each calendar.holidays as holiday (holiday.id)}
						<li class="flex items-baseline justify-between gap-3 text-2xs">
							<span class="min-w-0 truncate">{holiday.name}</span>
							<span class="font-mono text-ink-muted"
								>{holiday.date.slice(8)}.{holiday.date.slice(5, 7)}.</span
							>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}

		{#if legend.length === 0 && !loading}
			<Badge tone="warning">{$_('calendar.noTypes')}</Badge>
		{/if}
	</div>
</div>
