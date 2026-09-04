<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import {
		amountFor,
		effectiveHourlyRate,
		formatDuration,
		isTimeEntryRunning,
		type ProjectSummary,
		type TaskSummary,
		type TimeEntrySummary
	} from '@beacon/shared';
	import { Alert, Badge, Button, Card, Clock, SelectField, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { formatAmount } from '$lib/time-entries/labels';
	import { listProjects, getProject } from '$lib/api/projects';
	import {
		createManualTimeEntry,
		deleteTimeEntry,
		getRunningTimer,
		listMyTimeEntries,
		startTimer,
		stopTimer
	} from '$lib/api/time-entries';
	import { timeEntryErrorKey } from '$lib/time-entries/errors';

	const lang = $derived($locale ?? 'en');
	const today = new Date().toISOString().slice(0, 10);

	let projects = $state<ProjectSummary[]>([]);
	let taskCache = $state<Record<string, TaskSummary[]>>({});
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);

	let running = $state<TimeEntrySummary | undefined>(undefined);
	let entries = $state<TimeEntrySummary[]>([]);

	$effect(() => {
		void init();
	});

	async function init() {
		loading = true;
		loadErrorKey = null;

		try {
			[projects, running] = await Promise.all([listProjects(), getRunningTimer()]);
			entries = await listMyTimeEntries();
		} catch (error) {
			loadErrorKey = timeEntryErrorKey(error);
		} finally {
			loading = false;
		}
	}

	async function refetchEntries() {
		try {
			entries = await listMyTimeEntries();
		} catch (error) {
			loadErrorKey = timeEntryErrorKey(error);
		}
	}

	/** Tasks are fetched per project, on demand, and cached for the life of the page. */
	async function tasksFor(projectId: string): Promise<TaskSummary[]> {
		if (!projectId) return [];
		if (taskCache[projectId]) return taskCache[projectId];

		const detail = await getProject(projectId);
		taskCache = { ...taskCache, [projectId]: detail.tasks.filter((task) => task.active) };

		return taskCache[projectId];
	}

	// ── The timer ────────────────────────────────────────────────────────────────
	let startProjectId = $state('');
	let startTaskId = $state('');
	let startNote = $state('');
	let startTasks = $state<TaskSummary[]>([]);
	let starting = $state(false);
	let stopping = $state(false);
	let timerErrorKey = $state<string | null>(null);

	$effect(() => {
		const id = startProjectId;
		startTaskId = '';
		void (async () => (startTasks = await tasksFor(id)))();
	});

	/** The rate that would apply if the timer were started right now — a preview only. */
	const startRatePreview = $derived.by(() => {
		const project = projects.find((item) => item.id === startProjectId);
		if (!project) return null;
		const task = startTasks.find((item) => item.id === startTaskId) ?? null;

		return effectiveHourlyRate(project, task);
	});

	async function submitStart(event: SubmitEvent) {
		event.preventDefault();
		if (!startProjectId) {
			timerErrorKey = 'errors.checkFields';
			return;
		}

		starting = true;
		timerErrorKey = null;

		try {
			running = await startTimer({
				projectId: startProjectId,
				taskId: startTaskId || undefined,
				note: startNote.trim() || null
			});
			startProjectId = '';
			startTaskId = '';
			startNote = '';
		} catch (error) {
			timerErrorKey = timeEntryErrorKey(error);
		} finally {
			starting = false;
		}
	}

	async function submitStop() {
		if (!running) return;

		stopping = true;
		timerErrorKey = null;

		try {
			await stopTimer(running.id);
			running = undefined;
			await refetchEntries();
		} catch (error) {
			timerErrorKey = timeEntryErrorKey(error);
		} finally {
			stopping = false;
		}
	}

	// ── A running timer's live estimate, ticking the same way <Clock> does ──────
	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const runningMinutes = $derived(
		running?.startedAt
			? Math.max(0, Math.round((now - new Date(running.startedAt).getTime()) / 60_000))
			: 0
	);
	const runningEstimate = $derived(
		running?.billable && running.rateAtEntry !== null
			? amountFor(runningMinutes, running.rateAtEntry)
			: null
	);

	// ── A manual entry ───────────────────────────────────────────────────────────
	let manualProjectId = $state('');
	let manualTaskId = $state('');
	let manualTasks = $state<TaskSummary[]>([]);
	let manualDate = $state(today);
	let manualMode = $state<'duration' | 'range'>('duration');
	let manualDuration = $state('');
	let manualStart = $state('');
	let manualEnd = $state('');
	let manualBillable = $state(true);
	let manualNote = $state('');
	let manualSaving = $state(false);
	let manualErrorKey = $state<string | null>(null);

	$effect(() => {
		const id = manualProjectId;
		manualTaskId = '';
		void (async () => (manualTasks = await tasksFor(id)))();
	});

	async function submitManual(event: SubmitEvent) {
		event.preventDefault();
		if (!manualProjectId || !manualDate) {
			manualErrorKey = 'errors.checkFields';
			return;
		}

		manualSaving = true;
		manualErrorKey = null;

		try {
			await createManualTimeEntry({
				projectId: manualProjectId,
				taskId: manualTaskId || undefined,
				localDate: manualDate,
				billable: manualBillable,
				note: manualNote.trim() || null,
				...(manualMode === 'duration'
					? { durationMinutes: Number(manualDuration) }
					: {
							startedAt: `${manualDate}T${manualStart}:00.000Z`,
							endedAt: `${manualDate}T${manualEnd}:00.000Z`
						})
			});
			manualDuration = '';
			manualStart = '';
			manualEnd = '';
			manualNote = '';
			await refetchEntries();
		} catch (error) {
			manualErrorKey = timeEntryErrorKey(error);
		} finally {
			manualSaving = false;
		}
	}

	async function removeEntry(id: string) {
		if (!confirm($_('timeTracking.confirmDelete'))) return;

		try {
			await deleteTimeEntry(id);
			await refetchEntries();
		} catch (error) {
			loadErrorKey = timeEntryErrorKey(error);
		}
	}

	function projectName(id: string): string {
		return projects.find((project) => project.id === id)?.name ?? '';
	}
</script>

<svelte:head>
	<title>{$_('timeTracking.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('timeTracking.kicker')} title={$_('timeTracking.title')} />

{#if loadErrorKey}
	<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
{/if}

{#if !loading}
	<div class="mt-6 grid gap-4 lg:grid-cols-2">
		<!-- ---------------------------------------------------------------- the timer -->
		<Card variant="panel" as="section">
			<h2 class="text-base font-bold tracking-tight">{$_('timeTracking.timer.title')}</h2>

			{#if timerErrorKey}
				<Alert tone="warning" class="mt-3">{$_(timerErrorKey)}</Alert>
			{/if}

			{#if running}
				<div class="mt-4 flex flex-col gap-3">
					<div>
						<p class="text-sm font-semibold">{running.projectName}</p>
						{#if running.taskName}
							<p class="text-xs text-ink-muted">{running.taskName}</p>
						{/if}
					</div>
					<Clock since={running.startedAt} size="lg" />
					{#if runningEstimate !== null}
						<p class="text-xs text-ink-muted">
							{$_('timeTracking.timer.estimate', {
								values: { amount: formatAmount(runningEstimate, lang) }
							})}
						</p>
					{/if}
					<Button variant="primary" onclick={submitStop} disabled={stopping}>
						{stopping ? $_('timeTracking.timer.stopping') : $_('timeTracking.timer.stop')}
					</Button>
				</div>
			{:else}
				<form class="mt-4 flex flex-col gap-4" onsubmit={submitStart} novalidate>
					<SelectField
						id="start-project"
						label={$_('timeTracking.project')}
						bind:value={startProjectId}
					>
						<option value="">{$_('timeTracking.selectProject')}</option>
						{#each projects as project (project.id)}
							<option value={project.id}>{project.name}</option>
						{/each}
					</SelectField>
					{#if startTasks.length > 0}
						<SelectField id="start-task" label={$_('timeTracking.task')} bind:value={startTaskId}>
							<option value="">{$_('timeTracking.noTask')}</option>
							{#each startTasks as task (task.id)}
								<option value={task.id}>{task.name}</option>
							{/each}
						</SelectField>
					{/if}
					<TextField id="start-note" label={$_('timeTracking.note')} bind:value={startNote} />
					{#if startRatePreview !== null}
						<p class="text-xs text-ink-muted">
							{$_('timeTracking.timer.ratePreview', {
								values: { amount: formatAmount(startRatePreview, lang) }
							})}
						</p>
					{/if}
					<Button type="submit" variant="primary" disabled={starting}>
						{starting ? $_('timeTracking.timer.starting') : $_('timeTracking.timer.start')}
					</Button>
				</form>
			{/if}
		</Card>

		<!-- ---------------------------------------------------------------- manual entry -->
		<Card variant="panel" as="section">
			<h2 class="text-base font-bold tracking-tight">{$_('timeTracking.manual.title')}</h2>

			{#if manualErrorKey}
				<Alert tone="warning" class="mt-3">{$_(manualErrorKey)}</Alert>
			{/if}

			<form class="mt-4 flex flex-col gap-4" onsubmit={submitManual} novalidate>
				<SelectField
					id="manual-project"
					label={$_('timeTracking.project')}
					bind:value={manualProjectId}
				>
					<option value="">{$_('timeTracking.selectProject')}</option>
					{#each projects as project (project.id)}
						<option value={project.id}>{project.name}</option>
					{/each}
				</SelectField>
				{#if manualTasks.length > 0}
					<SelectField id="manual-task" label={$_('timeTracking.task')} bind:value={manualTaskId}>
						<option value="">{$_('timeTracking.noTask')}</option>
						{#each manualTasks as task (task.id)}
							<option value={task.id}>{task.name}</option>
						{/each}
					</SelectField>
				{/if}
				<TextField
					id="manual-date"
					label={$_('timeTracking.manual.date')}
					type="date"
					bind:value={manualDate}
					required
				/>

				<fieldset class="flex items-center gap-1.5">
					<legend class="sr-only">{$_('timeTracking.manual.modeLegend')}</legend>
					<Button
						type="button"
						size="sm"
						variant={manualMode === 'duration' ? 'primary' : 'quiet'}
						aria-pressed={manualMode === 'duration'}
						onclick={() => (manualMode = 'duration')}
					>
						{$_('timeTracking.manual.modeDuration')}
					</Button>
					<Button
						type="button"
						size="sm"
						variant={manualMode === 'range' ? 'primary' : 'quiet'}
						aria-pressed={manualMode === 'range'}
						onclick={() => (manualMode = 'range')}
					>
						{$_('timeTracking.manual.modeRange')}
					</Button>
				</fieldset>

				{#if manualMode === 'duration'}
					<TextField
						id="manual-duration"
						label={$_('timeTracking.manual.durationMinutes')}
						type="number"
						min="1"
						bind:value={manualDuration}
						required
					/>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						<TextField
							id="manual-start"
							label={$_('timeTracking.manual.startedAt')}
							type="time"
							bind:value={manualStart}
							required
						/>
						<TextField
							id="manual-end"
							label={$_('timeTracking.manual.endedAt')}
							type="time"
							bind:value={manualEnd}
							required
						/>
					</div>
				{/if}

				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={manualBillable} />
					{$_('timeTracking.manual.billable')}
				</label>

				<TextField id="manual-note" label={$_('timeTracking.note')} bind:value={manualNote} />

				<Button type="submit" variant="primary" disabled={manualSaving}>
					{manualSaving ? $_('timeTracking.manual.saving') : $_('timeTracking.manual.submit')}
				</Button>
			</form>
		</Card>
	</div>

	<!-- ---------------------------------------------------------------- my entries -->
	<Card variant="panel" as="section" class="mt-4">
		<h2 class="text-base font-bold tracking-tight">{$_('timeTracking.entries.title')}</h2>

		{#if entries.length === 0}
			<p class="mt-4 text-sm text-ink-muted">{$_('timeTracking.entries.empty')}</p>
		{:else}
			<div class="mt-4 overflow-x-auto">
				<table class="w-full min-w-[46rem] border-collapse text-sm">
					<thead>
						<tr class="border-b border-border-default text-left text-2xs text-ink-muted">
							<th scope="col" class="py-2 pr-3 font-semibold">{$_('timeTracking.entries.date')}</th>
							<th scope="col" class="py-2 pr-3 font-semibold">{$_('timeTracking.project')}</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('timeTracking.entries.duration')}
							</th>
							<th scope="col" class="py-2 pr-3 text-right font-semibold">
								{$_('timeTracking.entries.amount')}
							</th>
							<th scope="col" class="py-2"></th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry (entry.id)}
							<tr class="border-b border-border-subtle">
								<td class="py-3 pr-3">{entry.localDate}</td>
								<td class="py-3 pr-3">
									<span class="font-semibold"
										>{entry.projectName || projectName(entry.projectId)}</span
									>
									{#if entry.taskName}
										<span class="ml-1 text-xs text-ink-muted">· {entry.taskName}</span>
									{/if}
									{#if !entry.billable}
										<Badge tone="neutral" class="ml-2"
											>{$_('timeTracking.manual.nonBillable')}</Badge
										>
									{/if}
									{#if isTimeEntryRunning(entry)}
										<Badge tone="info" class="ml-2">{$_('timeTracking.timer.running')}</Badge>
									{/if}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{entry.durationMinutes !== null ? formatDuration(entry.durationMinutes) : '—'}
								</td>
								<td class="py-3 pr-3 text-right font-mono tabular-nums">
									{formatAmount(entry.amount, lang)}
								</td>
								<td class="py-3 text-right">
									{#if !isTimeEntryRunning(entry)}
										<Button size="sm" variant="quiet" onclick={() => removeEntry(entry.id)}>
											{$_('timeTracking.entries.delete')}
										</Button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
{/if}
