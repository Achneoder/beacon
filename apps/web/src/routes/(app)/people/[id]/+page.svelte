<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { page } from '$app/state';
	import type { DepartmentSummary, TeamSummary, UserDetail, UserSummary } from '@beacon/shared';
	import { fullName } from '@beacon/shared';
	import { Alert, Badge, Button, Card } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { Field, PersonCard } from '$lib/components/people';
	import {
		disablePerson,
		getPerson,
		listDepartments,
		listPeople,
		listTeams,
		updatePerson
	} from '$lib/api/people';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import {
		contractKey,
		formatDate,
		locationLine,
		statusKey,
		statusTone,
		workLocationKey
	} from '$lib/people/labels';

	let person = $state<UserDetail | null>(null);
	let loadErrorKey = $state<string | null>(null);
	let working = $state(false);

	const id = $derived(page.params.id);
	const lang = $derived($locale ?? 'en');
	const notSet = $derived($_('people.notSet'));
	const canManage = $derived(session.can('employee:manage'));

	$effect(() => {
		void load(id);
	});

	async function load(userId: string | undefined) {
		if (!userId) return;
		loadErrorKey = null;

		try {
			person = await getPerson(userId);
		} catch (error) {
			loadErrorKey = errorKey(error);
		}
	}

	// ── Assignment: department, team and manager — the fields only employee:manage may set ──
	let departments = $state<DepartmentSummary[]>([]);
	let teams = $state<TeamSummary[]>([]);
	let managers = $state<UserSummary[]>([]);
	let editingAssignment = $state(false);
	let savingAssignment = $state(false);
	let assignmentSaved = $state(false);
	let assignmentErrorKey = $state<string | null>(null);

	let departmentId = $state('');
	let teamId = $state('');
	let managerId = $state('');

	$effect(() => {
		if (canManage) void loadAssignmentOptions();
	});

	async function loadAssignmentOptions() {
		try {
			[departments, teams, managers] = await Promise.all([
				listDepartments(),
				listTeams(),
				listPeople({ status: 'active' })
			]);
		} catch {
			// The edit form falls back to the department/team already on the person; the
			// selects just come up empty rather than blocking the read-only view.
		}
	}

	function startEditingAssignment() {
		if (!person) return;
		departmentId = person.departmentId ?? '';
		teamId = person.teamId ?? '';
		managerId = person.managerId ?? '';
		assignmentErrorKey = null;
		assignmentSaved = false;
		editingAssignment = true;
	}

	async function saveAssignment(event: SubmitEvent) {
		event.preventDefault();
		if (!person) return;

		savingAssignment = true;
		assignmentErrorKey = null;

		try {
			person = await updatePerson(person.id, {
				departmentId: departmentId || null,
				teamId: teamId || null,
				managerId: managerId || null
			});
			editingAssignment = false;
			assignmentSaved = true;
		} catch (error) {
			assignmentErrorKey = errorKey(error);
		} finally {
			savingAssignment = false;
		}
	}

	/** Soft delete: the account is disabled so its history keeps its author. */
	async function disable() {
		if (!person || !confirm($_('people.disableConfirm', { values: { name: fullName(person) } }))) {
			return;
		}

		working = true;
		try {
			person = await disablePerson(person.id);
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			working = false;
		}
	}

	const location = $derived(
		person
			? locationLine(
					person.office,
					workLocationKey(person.workLocation)
						? $_(workLocationKey(person.workLocation) as string)
						: null
				)
			: null
	);
	const contract = $derived(
		person && contractKey(person.contractType)
			? $_(contractKey(person.contractType) as string)
			: null
	);
</script>

<svelte:head>
	<title>{person ? fullName(person) : $_('people.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('people.kicker')} title={person ? fullName(person) : $_('people.title')} />

<a
	href="/people"
	class="mt-4 inline-block rounded-control text-xs font-semibold text-accent-on-soft hover:underline"
>
	← {$_('people.backToPeople')}
</a>

{#if loadErrorKey}
	<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
{:else if !person}
	<p class="mt-6 text-sm text-ink-muted">{$_('people.loading')}</p>
{:else}
	{#if assignmentSaved}
		<Alert tone="success" live="status" class="mt-6">{$_('people.assignmentSaved')}</Alert>
	{/if}

	<Card variant="panel" as="section" class="mt-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<PersonCard name={fullName(person)} subtitle={person.jobTitle} size="lg" />
			<div class="flex items-center gap-2">
				<Badge tone={statusTone(person.status)}>{$_(statusKey(person.status))}</Badge>
				<Badge tone="neutral" class="font-mono">{person.employeeNumber ?? notSet}</Badge>
				{#if canManage && !editingAssignment}
					<Button size="sm" variant="ghost" onclick={startEditingAssignment}>
						{$_('people.editAssignment')}
					</Button>
				{/if}
			</div>
		</div>

		<dl class="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
			<Field label={$_('profile.email')} value={person.email} placeholder={notSet} />
			<Field label={$_('profile.phone')} value={person.phone} placeholder={notSet} mono />
			<Field label={$_('profile.department')} value={person.departmentName} placeholder={notSet} />
			<Field label={$_('profile.team')} value={person.teamName} placeholder={notSet} />
			<Field
				label={$_('profile.startDate')}
				value={formatDate(person.startsOn, lang)}
				placeholder={notSet}
				mono
			/>
			<Field label={$_('profile.contract')} value={contract} placeholder={notSet} />
			<Field label={$_('profile.location')} value={location} placeholder={notSet} />
			<Field label={$_('people.manager')} value={person.managerName} placeholder={notSet} />
		</dl>

		{#if editingAssignment}
			<form class="mt-8 border-t border-border-subtle pt-6" onsubmit={saveAssignment} novalidate>
				<p class="text-xs text-ink-muted">{$_('people.editAssignmentHint')}</p>

				{#if assignmentErrorKey}
					<Alert tone="warning" class="mt-4">{$_(assignmentErrorKey)}</Alert>
				{/if}

				<div class="mt-4 grid gap-4 sm:grid-cols-3">
					<div class="flex flex-col gap-1.5">
						<label for="person-department" class="text-sm font-semibold">
							{$_('profile.department')}
						</label>
						<select
							id="person-department"
							bind:value={departmentId}
							class="rounded-control border border-border-default bg-surface px-3.5 py-2.5 text-sm"
						>
							<option value="">{$_('people.noDepartmentOption')}</option>
							{#each departments as department (department.id)}
								<option value={department.id}>{department.name}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="person-team" class="text-sm font-semibold">{$_('profile.team')}</label>
						<select
							id="person-team"
							bind:value={teamId}
							class="rounded-control border border-border-default bg-surface px-3.5 py-2.5 text-sm"
						>
							<option value="">{$_('people.noTeamOption')}</option>
							{#each teams as team (team.id)}
								<option value={team.id}>{team.name}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="person-manager" class="text-sm font-semibold">
							{$_('people.manager')}
						</label>
						<select
							id="person-manager"
							bind:value={managerId}
							class="rounded-control border border-border-default bg-surface px-3.5 py-2.5 text-sm"
						>
							<option value="">{$_('people.noManagerOption')}</option>
							{#each managers as candidate (candidate.id)}
								{#if candidate.id !== person.id}
									<option value={candidate.id}>{fullName(candidate)}</option>
								{/if}
							{/each}
						</select>
					</div>
				</div>

				<div class="mt-5 flex gap-3">
					<Button type="submit" variant="primary" size="sm" disabled={savingAssignment}>
						{savingAssignment ? $_('profile.saving') : $_('profile.save')}
					</Button>
					<Button size="sm" variant="quiet" onclick={() => (editingAssignment = false)}>
						{$_('profile.cancel')}
					</Button>
				</div>
			</form>
		{/if}
	</Card>

	<div class="mt-6 grid gap-6 lg:grid-cols-2">
		<Card as="section">
			<h2 class="text-sm font-bold">{$_('people.roles')}</h2>
			<ul class="mt-4 flex flex-wrap gap-2">
				{#each person.roles as role (role.id)}
					<li><Badge tone="accent">{$_(`roles.${role.key}`, { default: role.name })}</Badge></li>
				{/each}
			</ul>
			<p class="mt-3 text-xs text-ink-muted">{$_('settings.rolesHint')}</p>
		</Card>

		{#if canManage && person.status !== 'disabled' && person.id !== session.user?.id}
			<Card as="section">
				<h2 class="text-sm font-bold">{$_('people.disable')}</h2>
				<p class="mt-2 text-xs text-ink-muted">
					{$_('people.disableConfirm', { values: { name: fullName(person) } })}
				</p>
				<Button class="mt-4" size="sm" variant="ghost" disabled={working} onclick={disable}>
					{$_('people.disable')}
				</Button>
			</Card>
		{/if}
	</div>
{/if}
