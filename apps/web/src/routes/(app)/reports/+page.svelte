<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import {
		formatDays,
		formatDuration,
		formatSignedDuration,
		type AbsenceRequestSummary,
		type AbsenceSummary,
		type AttendanceSummary,
		type AttendanceSummaryRow,
		type CorrectionSummary,
		type ReportGroupBy
	} from '@beacon/shared';
	import { Alert, Badge, Button, Card, StatTile } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { BarChart, type BarRow, type BarSeries } from '$lib/components/charts';
	import { balanceTone } from '$lib/attendance/labels';
	import { formatRange, rangeFor, reportYears, REPORT_RANGES } from '$lib/reports/ranges';
	import type { ReportRangeKey } from '$lib/reports/ranges';
	import { downloadAttendanceCsv, getAbsenceSummary, getAttendanceSummary } from '$lib/api/reports';
	import { listCorrections } from '$lib/api/attendance';
	import { getCalendar, listAbsences } from '$lib/api/absences';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';

	/**
	 * The manager's screen. Undesigned in the canvas — every screen there is the
	 * employee's own view — so this is built from the same tokens and primitives as
	 * `/approvals` and `/people`, and owes a canvas pass alongside them.
	 *
	 * Three bands, one route. Keeping the dashboard here rather than on a sixth nav
	 * entry matters: the sidebar is already longer for a manager than the canvas ever
	 * drew it, and the dashboard's cards are answers to "what needs me today" that
	 * lead naturally into the reports below them.
	 *
	 * Each band loads on its own and shows its own failure. They were one
	 * `Promise.all` for about ten minutes, which is exactly the mistake the Today
	 * screen already made and undid: a failing absence call must not blank the
	 * attendance table beside it.
	 */
	const lang = $derived($locale ?? 'en');
	const today = $derived(new Date().toISOString().slice(0, 10));

	let rangeKey = $state<ReportRangeKey>('thisMonth');
	let groupBy = $state<ReportGroupBy>('user');
	let year = $state(new Date().getUTCFullYear());

	const range = $derived(rangeFor(rangeKey, today));

	let attendance = $state<AttendanceSummary | null>(null);
	let attendanceErrorKey = $state<string | null>(null);
	let loadingAttendance = $state(true);

	let absence = $state<AbsenceSummary | null>(null);
	let absenceErrorKey = $state<string | null>(null);
	let loadingAbsence = $state(true);

	let corrections = $state<CorrectionSummary[]>([]);
	let pendingAbsences = $state<AbsenceRequestSummary[]>([]);
	let outThisWeek = $state<AbsenceRequestSummary[]>([]);
	let dashboardErrorKey = $state<string | null>(null);

	let exporting = $state(false);
	let exportErrorKey = $state<string | null>(null);

	const canApproveTime = $derived(session.can('attendance:approve'));
	const canApproveLeave = $derived(session.can('holiday:approve'));

	const pendingCount = $derived(
		corrections.filter((item) => item.status === 'pending').length + pendingAbsences.length
	);

	$effect(() => {
		void loadAttendance(range.from, range.to, groupBy);
	});

	$effect(() => {
		void loadAbsence(year);
	});

	$effect(() => {
		void loadDashboard(canApproveTime, canApproveLeave);
	});

	async function loadAttendance(from: string, to: string, by: ReportGroupBy) {
		loadingAttendance = true;
		attendanceErrorKey = null;

		try {
			attendance = await getAttendanceSummary({ from, to, groupBy: by });
		} catch (error) {
			attendanceErrorKey = errorKey(error);
		} finally {
			loadingAttendance = false;
		}
	}

	async function loadAbsence(forYear: number) {
		loadingAbsence = true;
		absenceErrorKey = null;

		try {
			absence = await getAbsenceSummary(forYear);
		} catch (error) {
			absenceErrorKey = errorKey(error);
		} finally {
			loadingAbsence = false;
		}
	}

	/**
	 * The dashboard band composes calls that already exist rather than adding a
	 * fourth endpoint: the approval queues are the same two the `/approvals` screen
	 * reads, and "who is out" is the organization calendar for this week.
	 */
	async function loadDashboard(approveTime: boolean, approveLeave: boolean) {
		dashboardErrorKey = null;

		const monday = mondayOf(today);
		const sunday = addDays(monday, 6);

		try {
			const [rawCorrections, rawAbsences, calendar] = await Promise.all([
				approveTime ? listCorrections(false) : Promise.resolve([]),
				approveLeave ? listAbsences({ status: 'pending' }) : Promise.resolve([]),
				getCalendar(monday, sunday, approveLeave ? 'organization' : 'team')
			]);

			corrections = rawCorrections;
			pendingAbsences = rawAbsences;
			outThisWeek = uniqueByPerson(calendar.days.flatMap((day) => day.absences));
		} catch (error) {
			dashboardErrorKey = errorKey(error);
		}
	}

	async function exportCsv() {
		exporting = true;
		exportErrorKey = null;

		try {
			await downloadAttendanceCsv(range, `beacon-attendance-${range.from}-to-${range.to}.csv`);
		} catch (error) {
			exportErrorKey = errorKey(error);
		} finally {
			exporting = false;
		}
	}

	function mondayOf(date: string): string {
		const at = new Date(`${date}T00:00:00Z`);

		return addDays(date, -((at.getUTCDay() + 6) % 7));
	}

	function addDays(date: string, days: number): string {
		const at = new Date(`${date}T00:00:00Z`);
		at.setUTCDate(at.getUTCDate() + days);

		return at.toISOString().slice(0, 10);
	}

	/** A person who booked two absences this week is one person who is out. */
	function uniqueByPerson(absences: AbsenceRequestSummary[]): AbsenceRequestSummary[] {
		const seen = new Map<string, AbsenceRequestSummary>();
		for (const item of absences) {
			if (item.status === 'rejected') continue;
			if (!seen.has(item.userId)) seen.set(item.userId, item);
		}

		return [...seen.values()];
	}

	const ATTENDANCE_SERIES: BarSeries[] = [{ key: 'worked', label: '' }];

	/**
	 * Worked against expected, with expected as a reference tick rather than a second
	 * bar. They are the same measure on the same scale, so a tick states the target
	 * without inviting the reader to compare two bar lengths that mean different
	 * things — and it is not, under any circumstances, a second axis.
	 */
	const attendanceChart = $derived<BarRow[]>(
		(attendance?.rows ?? []).map((row) => ({
			key: row.subjectId ?? 'unassigned',
			label: row.subjectName,
			segments: [{ seriesKey: 'worked', value: row.workedMinutes }],
			marker: row.expectedMinutes,
			valueLabel: formatDuration(row.workedMinutes)
		}))
	);

	const absenceSeries = $derived<BarSeries[]>([
		{ key: 'taken', label: $_('reports.absence.taken') },
		{ key: 'pending', label: $_('reports.absence.pending') }
	]);

	const absenceChart = $derived<BarRow[]>(
		(absence?.rows ?? []).map((row) => ({
			key: row.userId,
			label: row.userName,
			segments: [
				{ seriesKey: 'taken', value: row.takenDays },
				{ seriesKey: 'pending', value: row.pendingDays }
			],
			marker: row.entitlementDays + row.carryOverDays,
			valueLabel: formatDays(row.takenDays + row.pendingDays)
		}))
	);

	const days = (value: number) => `${formatDays(value)} ${$_('reports.absence.daysUnit')}`;

	/** A department row stands for many people; a user row stands for one. */
	const rowLabel = (row: AttendanceSummaryRow) =>
		row.subjectName || $_('reports.attendance.unassigned');
</script>

<PageHeader kicker={$_('reports.kicker')} title={$_('reports.title')} />

<!-- ------------------------------------------------------------ the dashboard -->

{#if dashboardErrorKey}
	<Alert tone="warning" class="mt-6">{$_(dashboardErrorKey)}</Alert>
{/if}

<section class="mt-6" aria-labelledby="reports-dashboard">
	<h2 id="reports-dashboard" class="sr-only">{$_('reports.dashboard')}</h2>
	<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
		<StatTile
			label={$_('reports.tiles.pending')}
			value={String(pendingCount)}
			hint={$_('reports.tiles.pendingHint')}
			tone={pendingCount > 0 ? 'warning' : 'neutral'}
		>
			{#snippet footer()}
				<a
					href="/approvals"
					class="rounded-control text-2xs font-semibold text-accent-on-soft underline
					       underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2
					       focus-visible:outline-accent"
				>
					{$_('reports.tiles.pendingLink')}
				</a>
			{/snippet}
		</StatTile>

		<StatTile
			label={$_('reports.tiles.out')}
			value={String(outThisWeek.length)}
			hint={$_('reports.tiles.outHint')}
			tone={outThisWeek.length > 0 ? 'info' : 'neutral'}
		>
			{#snippet footer()}
				{#if outThisWeek.length}
					<ul class="flex flex-wrap gap-1.5">
						{#each outThisWeek.slice(0, 4) as item (item.id)}
							<li><Badge tone="info">{item.userName}</Badge></li>
						{/each}
						{#if outThisWeek.length > 4}
							<li>
								<Badge tone="neutral">
									{$_('reports.tiles.more', { values: { count: outThisWeek.length - 4 } })}
								</Badge>
							</li>
						{/if}
					</ul>
				{/if}
			{/snippet}
		</StatTile>

		<StatTile
			label={$_('reports.tiles.overtime')}
			value={formatSignedDuration(attendance?.overtimeMinutes ?? 0)}
			aside={attendance
				? $_('reports.tiles.people', { values: { count: attendance.headcount } })
				: ''}
			hint={attendance && attendance.overCapCount > 0
				? $_('reports.tiles.overCap', { values: { count: attendance.overCapCount } })
				: $_('reports.tiles.overtimeHint')}
			tone={attendance && attendance.overCapCount > 0 ? 'warning' : 'neutral'}
		/>
	</div>
</section>

<!-- ------------------------------------------------------------ attendance -->

<Card variant="panel" as="section" class="mt-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-base font-bold tracking-tight">{$_('reports.attendance.title')}</h2>
			<p class="mt-1 font-mono text-2xs text-ink-muted">{formatRange(range, lang)}</p>
		</div>

		<Button size="sm" variant="ghost" disabled={exporting} onclick={exportCsv}>
			{exporting ? $_('reports.exporting') : $_('reports.export')}
		</Button>
	</div>

	<!-- One filter row above everything it scopes: the chart and the table below are
	     the same slice, never separately filtered. -->
	<div class="mt-4 flex flex-wrap items-center gap-4">
		<fieldset class="flex flex-wrap items-center gap-1.5">
			<legend class="sr-only">{$_('reports.range.legend')}</legend>
			{#each REPORT_RANGES as key (key)}
				<Button
					size="sm"
					variant={rangeKey === key ? 'primary' : 'quiet'}
					aria-pressed={rangeKey === key}
					onclick={() => (rangeKey = key)}
				>
					{$_(`reports.range.${key}`)}
				</Button>
			{/each}
		</fieldset>

		<fieldset class="flex flex-wrap items-center gap-1.5">
			<legend class="sr-only">{$_('reports.groupBy.legend')}</legend>
			{#each ['user', 'department'] as const as key (key)}
				<Button
					size="sm"
					variant={groupBy === key ? 'primary' : 'quiet'}
					aria-pressed={groupBy === key}
					onclick={() => (groupBy = key)}
				>
					{$_(`reports.groupBy.${key}`)}
				</Button>
			{/each}
		</fieldset>
	</div>

	{#if exportErrorKey}
		<Alert tone="warning" class="mt-3">{$_(exportErrorKey)}</Alert>
	{/if}
	{#if attendanceErrorKey}
		<Alert tone="warning" class="mt-3">{$_(attendanceErrorKey)}</Alert>
	{/if}

	{#if loadingAttendance && !attendance}
		<p class="mt-4 text-sm text-ink-muted">{$_('reports.loading')}</p>
	{:else if attendance}
		<!-- Held at reduced opacity while refetching rather than replaced by a
		     skeleton: the layout must not jump when the range changes. -->
		<div class="mt-5" class:opacity-60={loadingAttendance}>
			<BarChart
				title={$_('reports.attendance.chartTitle')}
				subtitle={$_('reports.attendance.chartSubtitle')}
				rows={attendanceChart}
				series={ATTENDANCE_SERIES}
				markerLabel={$_('reports.attendance.expected')}
				formatTick={(value) => formatDuration(value)}
				describedBy="reports-attendance-table"
				emptyLabel={$_('reports.attendance.empty')}
			/>

			<div class="mt-5 overflow-x-auto">
				<table id="reports-attendance-table" class="w-full min-w-[42rem] border-collapse text-sm">
					<caption class="sr-only">{$_('reports.attendance.caption')}</caption>
					<thead>
						<tr class="border-b border-border-default text-left text-2xs text-ink-muted">
							<th scope="col" class="py-2 pr-3 font-semibold">
								{$_(`reports.groupBy.${groupBy}`)}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.attendance.worked')}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.attendance.credited')}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.attendance.expected')}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.attendance.balance')}
							</th>
							<th scope="col" class="py-2 text-right font-semibold">
								{$_('reports.attendance.overtime')}
							</th>
						</tr>
					</thead>
					<tbody>
						{#each attendance.rows as row (row.subjectId ?? 'unassigned')}
							<tr class="border-b border-border-subtle">
								<th scope="row" class="py-3 pr-3 text-left font-semibold">
									{rowLabel(row)}
									{#if groupBy === 'department'}
										<span class="ml-2 text-2xs font-normal text-ink-muted">
											{$_('reports.tiles.people', { values: { count: row.headcount } })}
										</span>
									{/if}
								</th>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{formatDuration(row.workedMinutes)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums text-ink-muted">
									{formatDuration(row.creditedMinutes)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums text-ink-muted">
									{formatDuration(row.expectedMinutes)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									<span
										class:text-success={balanceTone(row.balanceMinutes) === 'success'}
										class:text-warning={balanceTone(row.balanceMinutes) === 'warning'}
									>
										{formatSignedDuration(row.balanceMinutes)}
									</span>
								</td>
								<td class="py-3 text-right font-mono tabular-nums">
									{#if row.overtime}
										{formatSignedDuration(row.overtime.balanceMinutes)}
										{#if row.overtime.overCap}
											<Badge tone="warning" class="ml-2">{$_('reports.attendance.overCap')}</Badge>
										{/if}
									{:else}
										<span class="text-ink-muted">—</span>
									{/if}
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="6" class="py-4 text-sm text-ink-muted">
									{$_('reports.attendance.empty')}
								</td>
							</tr>
						{/each}
					</tbody>
					{#if attendance.rows.length}
						<tfoot>
							<tr class="border-t border-border-default font-semibold">
								<th scope="row" class="py-3 pr-3 text-left">{$_('reports.total')}</th>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{formatDuration(attendance.total.workedMinutes)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{formatDuration(attendance.total.creditedMinutes)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{formatDuration(attendance.total.expectedMinutes)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{formatSignedDuration(attendance.total.balanceMinutes)}
								</td>
								<td class="py-3 text-right font-mono tabular-nums">
									{formatSignedDuration(attendance.overtimeMinutes)}
								</td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
		</div>
	{/if}
</Card>

<!-- ------------------------------------------------------------ absence -->

<Card variant="panel" as="section" class="mt-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<h2 class="text-base font-bold tracking-tight">{$_('reports.absence.title')}</h2>

		<fieldset class="flex flex-wrap items-center gap-1.5">
			<legend class="sr-only">{$_('reports.absence.yearLegend')}</legend>
			{#each reportYears(today) as option (option)}
				<Button
					size="sm"
					variant={year === option ? 'primary' : 'quiet'}
					aria-pressed={year === option}
					onclick={() => (year = option)}
				>
					{option}
				</Button>
			{/each}
		</fieldset>
	</div>

	{#if absenceErrorKey}
		<Alert tone="warning" class="mt-3">{$_(absenceErrorKey)}</Alert>
	{/if}

	{#if loadingAbsence && !absence}
		<p class="mt-4 text-sm text-ink-muted">{$_('reports.loading')}</p>
	{:else if absence}
		<div class="mt-5" class:opacity-60={loadingAbsence}>
			<BarChart
				title={$_('reports.absence.chartTitle', { values: { year: absence.year } })}
				subtitle={$_('reports.absence.chartSubtitle')}
				rows={absenceChart}
				series={absenceSeries}
				markerLabel={$_('reports.absence.entitlement')}
				formatTick={(value) => formatDays(value)}
				describedBy="reports-absence-table"
				emptyLabel={$_('reports.absence.empty')}
			/>

			<div class="mt-5 overflow-x-auto">
				<table id="reports-absence-table" class="w-full min-w-[38rem] border-collapse text-sm">
					<caption class="sr-only">{$_('reports.absence.caption')}</caption>
					<thead>
						<tr class="border-b border-border-default text-left text-2xs text-ink-muted">
							<th scope="col" class="py-2 pr-3 font-semibold">{$_('reports.absence.person')}</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.absence.entitlement')}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.absence.taken')}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('reports.absence.pending')}
							</th>
							<th scope="col" class="py-2 text-right font-semibold">
								{$_('reports.absence.remaining')}
							</th>
						</tr>
					</thead>
					<tbody>
						{#each absence.rows as row (row.userId)}
							<tr class="border-b border-border-subtle">
								<th scope="row" class="py-3 pr-3 text-left font-semibold">
									{row.userName}
									{#if row.departmentName}
										<span class="ml-2 text-2xs font-normal text-ink-muted">
											{row.departmentName}
										</span>
									{/if}
								</th>
								<td class="py-3 pr-3 text-right font-mono tabular-nums text-ink-muted">
									{days(row.entitlementDays + row.carryOverDays)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">{days(row.takenDays)}</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{days(row.pendingDays)}
								</td>
								<td class="py-3 text-right font-mono tabular-nums">{days(row.remainingDays)}</td>
							</tr>
						{:else}
							<tr>
								<td colspan="5" class="py-4 text-sm text-ink-muted">
									{$_('reports.absence.empty')}
								</td>
							</tr>
						{/each}
					</tbody>
					{#if absence.rows.length}
						<tfoot>
							<tr class="border-t border-border-default font-semibold">
								<th scope="row" class="py-3 pr-3 text-left">{$_('reports.total')}</th>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{days(absence.total.entitlementDays + absence.total.carryOverDays)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{days(absence.total.takenDays)}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{days(absence.total.pendingDays)}
								</td>
								<td class="py-3 text-right font-mono tabular-nums">
									{days(absence.total.remainingDays)}
								</td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
		</div>
	{/if}
</Card>
