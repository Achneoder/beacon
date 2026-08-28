<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { DepartmentSummary, OrganizationSummary, RoleSummary } from '@beacon/shared';
	import { Alert, Badge, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { api, apiSend } from '$lib/api/client';
	import { createDepartment, deleteDepartment, listDepartments } from '$lib/api/people';
	import { errorKey } from '$lib/auth/errors';

	let organization = $state<OrganizationSummary | null>(null);
	let roles = $state<RoleSummary[]>([]);
	let departments = $state<DepartmentSummary[]>([]);
	let loadErrorKey = $state<string | null>(null);

	let name = $state('');
	let timezone = $state('');
	let defaultLocale = $state('');
	let saving = $state(false);
	let saved = $state(false);
	let saveErrorKey = $state<string | null>(null);

	let newDepartment = $state('');
	let departmentErrorKey = $state<string | null>(null);

	$effect(() => {
		void load();
	});

	async function load() {
		try {
			organization = await api<OrganizationSummary>('/organizations/current');
			name = organization.name;
			timezone = organization.timezone;
			defaultLocale = organization.defaultLocale;
			roles = await api<RoleSummary[]>('/organizations/current/roles');
			departments = await listDepartments();
		} catch (error) {
			loadErrorKey = errorKey(error);
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saveErrorKey = null;
		saved = false;

		try {
			organization = await apiSend<OrganizationSummary>('/organizations/current', 'PATCH', {
				name: name.trim(),
				timezone: timezone.trim(),
				defaultLocale: defaultLocale.trim()
			});
			saved = true;
		} catch (error) {
			saveErrorKey = errorKey(error);
		} finally {
			saving = false;
		}
	}

	async function addDepartment(event: SubmitEvent) {
		event.preventDefault();
		if (!newDepartment.trim()) return;

		departmentErrorKey = null;
		try {
			departments = [...departments, await createDepartment({ name: newDepartment.trim() })];
			newDepartment = '';
		} catch (error) {
			departmentErrorKey = errorKey(error);
		}
	}

	async function removeDepartment(id: string) {
		await deleteDepartment(id);
		departments = departments.filter((department) => department.id !== id);
	}
</script>

<svelte:head>
	<title>{$_('settings.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('settings.kicker')} title={$_('settings.title')} />

{#if loadErrorKey}
	<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
{:else if !organization}
	<p class="mt-6 text-sm text-ink-muted">{$_('people.loading')}</p>
{:else}
	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('settings.general')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.generalHint')}</p>

		<form class="mt-5 flex flex-col gap-4" onsubmit={save} novalidate>
			{#if saved}
				<Alert tone="success" live="status">{$_('settings.saved')}</Alert>
			{/if}
			{#if saveErrorKey}
				<Alert tone="warning">{$_(saveErrorKey)}</Alert>
			{/if}

			<TextField id="settings-name" label={$_('settings.name')} required bind:value={name} />
			<div class="grid gap-4 sm:grid-cols-2">
				<TextField
					id="settings-timezone"
					label={$_('org.timezone')}
					hint="Europe/Berlin"
					bind:value={timezone}
				/>
				<TextField
					id="settings-locale"
					label={$_('org.defaultLocale')}
					hint="en · de"
					bind:value={defaultLocale}
				/>
			</div>

			<Button type="submit" variant="primary" size="sm" class="self-start" disabled={saving}>
				{saving ? $_('settings.saving') : $_('settings.save')}
			</Button>
		</form>
	</Card>

	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('settings.departments')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.departmentsHint')}</p>

		{#if departments.length === 0}
			<p class="mt-4 text-sm text-ink-muted">{$_('settings.noDepartments')}</p>
		{:else}
			<ul class="mt-4 flex flex-col gap-2">
				{#each departments as department (department.id)}
					<li
						class="flex items-center justify-between gap-3 border-b border-border-subtle pb-2 last:border-0"
					>
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold">{department.name}</span>
							<span class="block text-xs text-ink-muted">
								{$_('settings.members', { values: { count: department.memberCount } })}
							</span>
						</span>
						<Button size="sm" variant="quiet" onclick={() => removeDepartment(department.id)}>
							{$_('settings.delete')}
						</Button>
					</li>
				{/each}
			</ul>
		{/if}

		<form class="mt-5 flex flex-wrap items-end gap-3" onsubmit={addDepartment} novalidate>
			<TextField
				id="settings-new-department"
				label={$_('settings.departmentName')}
				class="w-full sm:w-72"
				error={departmentErrorKey ? $_(departmentErrorKey) : undefined}
				bind:value={newDepartment}
			/>
			<Button type="submit" size="sm">{$_('settings.addDepartment')}</Button>
		</form>
	</Card>

	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('settings.roles')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.rolesHint')}</p>

		<ul class="mt-4 flex flex-col gap-3">
			{#each roles as role (role.id)}
				<li class="flex flex-wrap items-center justify-between gap-3">
					<span class="text-sm font-semibold">
						{$_(`roles.${role.key}`, { default: role.name })}
					</span>
					<span class="flex items-center gap-2">
						<span class="font-mono text-xs text-ink-muted">
							{$_('settings.permissionCount', { values: { count: role.permissions.length } })}
						</span>
						{#if role.isSystem}
							<Badge tone="neutral">{$_('settings.systemRole')}</Badge>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	</Card>
{/if}
