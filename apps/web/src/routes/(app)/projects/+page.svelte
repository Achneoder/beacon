<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { ProjectDetail, ProjectSummary } from '@beacon/shared';
	import { Alert, Badge, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import {
		createProject,
		createTask,
		getProject,
		listProjects,
		retireProject,
		retireTask,
		updateProject,
		updateTask
	} from '$lib/api/projects';
	import { timeEntryErrorKey } from '$lib/time-entries/errors';
	import { session } from '$lib/auth/session.svelte';

	/**
	 * `bind:value` on a `type="number"` field yields a JS number at runtime, not the
	 * string `TextField`'s prop type promises — Svelte checks the DOM node's own
	 * `type` regardless of how the attribute reached it, so its `...rest` spread does
	 * not stop the coercion. `String(value)` first is what makes this safe against
	 * either actual runtime shape without fighting `TextField`'s own typing.
	 */
	function toRate(value: string): number | null {
		const trimmed = String(value).trim();

		return trimmed ? Number(trimmed) : null;
	}

	/**
	 * The catalog's admin screen: create, rename and retire projects and their tasks.
	 * Gated in the sidebar on `project:manage`; a `time:read`-only visitor who lands
	 * here directly still sees the list — the API is what actually refuses a write.
	 */
	const canManage = $derived(session.can('project:manage'));

	let projects = $state<ProjectSummary[]>([]);
	let includeInactive = $state(false);
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);

	$effect(() => {
		void load(includeInactive);
	});

	async function load(withInactive: boolean) {
		loading = true;
		loadErrorKey = null;

		try {
			projects = await listProjects(withInactive);
		} catch (error) {
			loadErrorKey = timeEntryErrorKey(error);
		} finally {
			loading = false;
		}
	}

	// ── Creating a project ──────────────────────────────────────────────────────
	let newName = $state('');
	let newClient = $state('');
	let newRate = $state('');
	let creating = $state(false);
	let createErrorKey = $state<string | null>(null);

	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		if (!newName.trim()) {
			createErrorKey = 'errors.checkFields';
			return;
		}

		creating = true;
		createErrorKey = null;

		try {
			await createProject({
				name: newName.trim(),
				clientName: newClient.trim() || null,
				hourlyRate: toRate(newRate)
			});
			newName = '';
			newClient = '';
			newRate = '';
			await load(includeInactive);
		} catch (error) {
			createErrorKey = timeEntryErrorKey(error);
		} finally {
			creating = false;
		}
	}

	async function retire(project: ProjectSummary) {
		if (!confirm($_('projects.confirmRetire'))) return;

		try {
			await retireProject(project.id);
			if (selected?.id === project.id) {
				selected = null;
				detail = null;
			}
			await load(includeInactive);
		} catch (error) {
			loadErrorKey = timeEntryErrorKey(error);
		}
	}

	// ── The inline detail panel ─────────────────────────────────────────────────
	let selected = $state<ProjectSummary | null>(null);
	let detail = $state<ProjectDetail | null>(null);
	let detailLoading = $state(false);
	let detailErrorKey = $state<string | null>(null);

	let editName = $state('');
	let editClient = $state('');
	let editDescription = $state('');
	let editRate = $state('');
	let editSaving = $state(false);
	let editErrorKey = $state<string | null>(null);

	async function selectProject(project: ProjectSummary) {
		if (selected?.id === project.id) {
			selected = null;
			detail = null;
			return;
		}

		selected = project;
		await loadDetail(project.id);
	}

	async function loadDetail(id: string) {
		detail = null;
		detailErrorKey = null;
		detailLoading = true;

		try {
			detail = await getProject(id, true);
			editName = detail.name;
			editClient = detail.clientName ?? '';
			editDescription = detail.description ?? '';
			editRate = detail.hourlyRate === null ? '' : String(detail.hourlyRate);
		} catch (error) {
			detailErrorKey = timeEntryErrorKey(error);
		} finally {
			detailLoading = false;
		}
	}

	async function submitEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!detail) return;

		editSaving = true;
		editErrorKey = null;

		try {
			const updated = await updateProject(detail.id, {
				name: editName.trim(),
				clientName: editClient.trim() || null,
				description: editDescription.trim() || null,
				hourlyRate: toRate(editRate)
			});
			detail = { ...detail, ...updated };
			await load(includeInactive);
		} catch (error) {
			editErrorKey = timeEntryErrorKey(error);
		} finally {
			editSaving = false;
		}
	}

	// ── Tasks within the selected project ───────────────────────────────────────
	let newTaskName = $state('');
	let newTaskRate = $state('');
	let taskSaving = $state(false);
	let taskErrorKey = $state<string | null>(null);

	async function submitTask(event: SubmitEvent) {
		event.preventDefault();
		if (!detail || !newTaskName.trim()) {
			taskErrorKey = 'errors.checkFields';
			return;
		}

		taskSaving = true;
		taskErrorKey = null;

		try {
			await createTask(detail.id, {
				name: newTaskName.trim(),
				hourlyRate: toRate(newTaskRate)
			});
			newTaskName = '';
			newTaskRate = '';
			await loadDetail(detail.id);
		} catch (error) {
			taskErrorKey = timeEntryErrorKey(error);
		} finally {
			taskSaving = false;
		}
	}

	async function retireTaskRow(taskId: string) {
		if (!detail) return;
		if (!confirm($_('projects.confirmRetireTask'))) return;

		try {
			await retireTask(detail.id, taskId);
			await loadDetail(detail.id);
		} catch (error) {
			detailErrorKey = timeEntryErrorKey(error);
		}
	}

	async function reactivateTask(taskId: string) {
		if (!detail) return;

		try {
			await updateTask(detail.id, taskId, {});
			await loadDetail(detail.id);
		} catch (error) {
			detailErrorKey = timeEntryErrorKey(error);
		}
	}
</script>

<svelte:head>
	<title>{$_('projects.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('projects.kicker')} title={$_('projects.title')} />

<Card variant="panel" as="section" class="mt-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-base font-bold tracking-tight">{$_('projects.listTitle')}</h2>
		<label class="flex items-center gap-2 text-sm text-ink-muted">
			<input type="checkbox" bind:checked={includeInactive} />
			{$_('projects.showRetired')}
		</label>
	</div>

	{#if loadErrorKey}
		<Alert tone="warning" class="mt-3">{$_(loadErrorKey)}</Alert>
	{:else if loading}
		<p class="mt-4 text-sm text-ink-muted">{$_('projects.loading')}</p>
	{:else if projects.length === 0}
		<p class="mt-4 text-sm text-ink-muted">{$_('projects.empty')}</p>
	{:else}
		<div class="mt-4 overflow-x-auto">
			<table class="w-full min-w-[42rem] border-collapse text-sm">
				<thead>
					<tr class="border-b border-border-default text-left text-2xs text-ink-muted">
						<th scope="col" class="py-2 pr-3 font-semibold">{$_('projects.name')}</th>
						<th scope="col" class="py-2 pr-3 font-semibold">{$_('projects.client')}</th>
						<th scope="col" class="py-2 pr-3 text-right font-semibold">{$_('projects.rate')}</th>
						<th scope="col" class="py-2 pr-3 text-right font-semibold">{$_('projects.tasks')}</th>
						<th scope="col" class="py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each projects as project (project.id)}
						<tr class="border-b border-border-subtle">
							<th scope="row" class="py-3 pr-3 text-left font-semibold">
								<button
									type="button"
									class="rounded-control underline-offset-2 hover:underline"
									onclick={() => selectProject(project)}
								>
									{project.name}
								</button>
								{#if !project.active}
									<Badge tone="neutral" class="ml-2">{$_('projects.retired')}</Badge>
								{/if}
							</th>
							<td class="py-3 pr-3 text-ink-muted">{project.clientName ?? '—'}</td>
							<td class="py-3 pr-3 text-right font-mono tabular-nums">
								{project.hourlyRate ?? '—'}
							</td>
							<td class="py-3 pr-3 text-right font-mono tabular-nums">{project.taskCount}</td>
							<td class="py-3 text-right">
								{#if canManage && project.active}
									<Button size="sm" variant="quiet" onclick={() => retire(project)}>
										{$_('projects.retire')}
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

{#if selected}
	<Card variant="panel" as="section" class="mt-5 flex flex-col gap-6">
		{#if detailErrorKey}
			<Alert tone="warning">{$_(detailErrorKey)}</Alert>
		{/if}

		{#if detailLoading && !detail}
			<p class="text-sm text-ink-muted">{$_('projects.loading')}</p>
		{:else if detail}
			<div>
				<h2 class="text-base font-bold">{detail.name}</h2>
			</div>

			{#if canManage}
				<form class="flex flex-col gap-4 sm:grid sm:grid-cols-2" onsubmit={submitEdit} novalidate>
					{#if editErrorKey}
						<Alert tone="warning" class="sm:col-span-2">{$_(editErrorKey)}</Alert>
					{/if}
					<TextField id="edit-name" label={$_('projects.name')} bind:value={editName} required />
					<TextField id="edit-client" label={$_('projects.client')} bind:value={editClient} />
					<TextField
						id="edit-description"
						label={$_('projects.description')}
						bind:value={editDescription}
						class="sm:col-span-2"
					/>
					<TextField
						id="edit-rate"
						label={$_('projects.rate')}
						type="number"
						min="0"
						step="0.01"
						bind:value={editRate}
					/>
					<div class="sm:col-span-2">
						<Button type="submit" variant="primary" size="sm" disabled={editSaving}>
							{editSaving ? $_('projects.saving') : $_('projects.save')}
						</Button>
					</div>
				</form>
			{/if}

			<div>
				<h3 class="text-sm font-bold">{$_('projects.tasksTitle')}</h3>
				{#if detail.tasks.length === 0}
					<p class="mt-2 text-sm text-ink-muted">{$_('projects.noTasks')}</p>
				{:else}
					<ul class="mt-3 flex flex-col gap-2">
						{#each detail.tasks as task (task.id)}
							<li
								class="flex items-center justify-between gap-3 rounded-control border border-border-subtle px-3 py-2"
							>
								<div>
									<span class="text-sm font-semibold">{task.name}</span>
									{#if !task.active}
										<Badge tone="neutral" class="ml-2">{$_('projects.retired')}</Badge>
									{/if}
								</div>
								<div class="flex items-center gap-3">
									<span class="font-mono text-sm tabular-nums text-ink-muted">
										{task.hourlyRate ?? '—'}
									</span>
									{#if canManage}
										{#if task.active}
											<Button size="sm" variant="quiet" onclick={() => retireTaskRow(task.id)}>
												{$_('projects.retire')}
											</Button>
										{:else}
											<Button size="sm" variant="quiet" onclick={() => reactivateTask(task.id)}>
												{$_('projects.reactivate')}
											</Button>
										{/if}
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}

				{#if canManage}
					<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={submitTask} novalidate>
						{#if taskErrorKey}
							<Alert tone="warning" class="w-full">{$_(taskErrorKey)}</Alert>
						{/if}
						<TextField
							id="new-task-name"
							label={$_('projects.taskName')}
							bind:value={newTaskName}
							required
						/>
						<TextField
							id="new-task-rate"
							label={$_('projects.rate')}
							type="number"
							min="0"
							step="0.01"
							bind:value={newTaskRate}
						/>
						<Button type="submit" size="sm" disabled={taskSaving}>
							{taskSaving ? $_('projects.saving') : $_('projects.addTask')}
						</Button>
					</form>
				{/if}
			</div>
		{/if}
	</Card>
{/if}

{#if canManage}
	<Card variant="panel" as="section" class="mt-5">
		<h2 class="text-sm font-bold">{$_('projects.newProject')}</h2>

		{#if createErrorKey}
			<Alert tone="warning" class="mt-3">{$_(createErrorKey)}</Alert>
		{/if}

		<form
			class="mt-4 flex flex-col gap-4 sm:grid sm:grid-cols-2"
			onsubmit={submitCreate}
			novalidate
		>
			<TextField id="create-name" label={$_('projects.name')} bind:value={newName} required />
			<TextField id="create-client" label={$_('projects.client')} bind:value={newClient} />
			<TextField
				id="create-rate"
				label={$_('projects.rate')}
				type="number"
				min="0"
				step="0.01"
				bind:value={newRate}
			/>
			<div class="sm:col-span-2">
				<Button type="submit" variant="primary" size="sm" disabled={creating}>
					{creating ? $_('projects.saving') : $_('projects.create')}
				</Button>
			</div>
		</form>
	</Card>
{/if}
