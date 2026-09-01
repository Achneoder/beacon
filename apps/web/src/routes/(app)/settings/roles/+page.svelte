<script lang="ts">
	import { _ } from 'svelte-i18n';
	import {
		PERMISSIONS,
		PERMISSION_AREAS,
		isOwnerRole,
		isSelfServicePermission,
		permissionArea,
		type Permission,
		type RoleSummary
	} from '@beacon/shared';
	import { Alert, Badge, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { createRole, deleteRole, listRoles, updateRole } from '$lib/api/roles';
	import { errorKey } from '$lib/auth/errors';
	import { session } from '$lib/auth/session.svelte';

	let roles = $state<RoleSummary[]>([]);
	let loaded = $state(false);
	let loadErrorKey = $state<string | null>(null);

	/** The role being edited, `'new'` while composing one, null when nothing is open. */
	let editing = $state<string | null>(null);
	let draftName = $state('');
	let draftPermissions = $state<Permission[]>([]);

	let saving = $state(false);
	let formErrorKey = $state<string | null>(null);
	let noticeKey = $state<string | null>(null);
	let actionErrorKey = $state<string | null>(null);

	const areas = PERMISSION_AREAS.map((area) => ({
		area,
		permissions: PERMISSIONS.filter((permission) => permissionArea(permission) === area)
	}));

	/**
	 * `organization:read` is enough to *see* the roles — the people screens and the
	 * document access panel both name them — but every mutation needs
	 * `organization:manage`. The built-in `admin` role holds the first and not the
	 * second, so without this the screen would offer it buttons that can only 403.
	 */
	const canManage = $derived(session.can('organization:manage'));

	/**
	 * Which permissions this administrator may put in a role. The API decides for real —
	 * `assertGrantable` refuses a permission the caller does not hold — so offering a
	 * checkbox that can only ever come back 403 would be a lie the form tells.
	 *
	 * The self-service exemption mirrors the server's: an administrator holds none of
	 * `attendance:write`, `holiday:request` or `document:write`, and still has to be
	 * able to maintain the employee role.
	 */
	function mayGrant(permission: Permission): boolean {
		return session.can(permission) || isSelfServicePermission(permission);
	}

	/** The same rule read backwards — a role already carrying authority beyond the
	 *  caller's is not theirs to rewrite, so the API refuses the edit outright. */
	function mayEdit(role: RoleSummary): boolean {
		return (
			canManage &&
			!isOwnerRole(role) &&
			role.permissions.every((permission) => mayGrant(permission))
		);
	}

	$effect(() => {
		void load();
	});

	async function load() {
		try {
			roles = await listRoles();
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			loaded = true;
		}
	}

	function startCreate() {
		editing = 'new';
		draftName = '';
		draftPermissions = [];
		formErrorKey = null;
		noticeKey = null;
	}

	function startEdit(role: RoleSummary) {
		editing = role.id;
		draftName = role.name;
		draftPermissions = [...role.permissions];
		formErrorKey = null;
		noticeKey = null;
	}

	function cancel() {
		editing = null;
		formErrorKey = null;
	}

	function toggle(permission: Permission, checked: boolean) {
		draftPermissions = checked
			? [...draftPermissions, permission]
			: draftPermissions.filter((held) => held !== permission);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = draftName.trim();
		if (!name) return;

		saving = true;
		formErrorKey = null;

		try {
			if (editing === 'new') {
				// Sorted by key, the order the API lists them in — so a created role lands
				// where a reload would put it rather than at the bottom.
				roles = [...roles, await createRole({ name, permissions: draftPermissions })].sort(
					(left, right) => left.key.localeCompare(right.key)
				);
				noticeKey = 'roleSettings.created';
			} else if (editing) {
				const role = roles.find((candidate) => candidate.id === editing);
				const updated = await updateRole(editing, {
					// A built-in role is renamed by nobody: the web shows it under its own
					// translated copy, so sending a name the server would refuse is pointless.
					name: role?.isSystem ? undefined : name,
					permissions: draftPermissions
				});
				roles = roles.map((candidate) => (candidate.id === updated.id ? updated : candidate));
				noticeKey = 'roleSettings.saved';
			}
			editing = null;
		} catch (error) {
			formErrorKey = errorKey(error);
		} finally {
			saving = false;
		}
	}

	async function remove(role: RoleSummary) {
		actionErrorKey = null;
		noticeKey = null;

		try {
			await deleteRole(role.id);
			roles = roles.filter((candidate) => candidate.id !== role.id);
			if (editing === role.id) editing = null;
			noticeKey = 'roleSettings.deleted';
		} catch (error) {
			actionErrorKey = errorKey(error);
		}
	}

	/** Built-in roles are shown under their translated name; custom ones under their own. */
	function label(role: RoleSummary): string {
		return role.isSystem ? $_(`roles.${role.key}`, { default: role.name }) : role.name;
	}
</script>

<svelte:head>
	<title>{$_('roleSettings.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('roleSettings.kicker')} title={$_('roleSettings.title')} />

<Card variant="panel" as="section" class="mt-6">
	<p class="text-xs text-ink-muted">{$_('roleSettings.intro')}</p>
	<p class="mt-2 text-xs text-ink-muted">{$_('roleSettings.tokenNote')}</p>

	{#if !canManage}
		<p class="mt-3 text-xs text-ink-muted">{$_('roleSettings.readOnly')}</p>
	{/if}

	<div class="mt-5 flex flex-wrap gap-3">
		{#if canManage}
			<Button size="sm" variant="primary" onclick={startCreate} disabled={editing === 'new'}>
				{$_('roleSettings.newRole')}
			</Button>
		{/if}
		<Button size="sm" variant="quiet" href="/settings/organization">
			{$_('roleSettings.back')}
		</Button>
	</div>
</Card>

{#if noticeKey}
	<Alert tone="success" live="status" class="mt-6">{$_(noticeKey)}</Alert>
{/if}
{#if actionErrorKey}
	<Alert tone="warning" class="mt-6">{$_(actionErrorKey)}</Alert>
{/if}

{#if loadErrorKey}
	<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
{:else if !loaded}
	<p class="mt-6 text-sm text-ink-muted">{$_('people.loading')}</p>
{:else}
	{#if editing === 'new'}
		<Card variant="panel" as="section" class="mt-6">
			<h2 class="text-sm font-bold">{$_('roleSettings.newRole')}</h2>

			<form class="mt-5 flex flex-col gap-5" onsubmit={submit} novalidate>
				{#if formErrorKey}
					<Alert tone="warning">{$_(formErrorKey)}</Alert>
				{/if}

				<TextField
					id="role-new-name"
					label={$_('roleSettings.name')}
					class="w-full sm:w-80"
					required
					bind:value={draftName}
				/>

				{@render permissionPicker('new')}

				<div class="flex flex-wrap gap-3">
					<Button type="submit" variant="primary" size="sm" disabled={saving}>
						{saving ? $_('roleSettings.saving') : $_('roleSettings.create')}
					</Button>
					<Button type="button" size="sm" variant="quiet" onclick={cancel}>
						{$_('roleSettings.cancel')}
					</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#each roles as role (role.id)}
		<Card variant="panel" as="section" class="mt-6">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="text-sm font-bold">{label(role)}</h2>
					<p class="mt-1 font-mono text-2xs text-ink-muted">{role.key}</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if role.isSystem}
						<Badge tone="neutral">{$_('settings.systemRole')}</Badge>
					{/if}
					{#if role.customized}
						<Badge tone="accent">{$_('roleSettings.customized')}</Badge>
					{/if}
					<span class="text-xs text-ink-muted">
						{role.memberCount === 0
							? $_('roleSettings.unused')
							: $_('roleSettings.inUse', { values: { count: role.memberCount } })}
					</span>
				</div>
			</div>

			{#if editing === role.id}
				<form class="mt-5 flex flex-col gap-5" onsubmit={submit} novalidate>
					{#if formErrorKey}
						<Alert tone="warning">{$_(formErrorKey)}</Alert>
					{/if}

					{#if role.isSystem}
						<p class="text-xs text-ink-muted">{$_('roleSettings.builtInName')}</p>
					{:else}
						<TextField
							id="role-{role.id}-name"
							label={$_('roleSettings.name')}
							class="w-full sm:w-80"
							required
							bind:value={draftName}
						/>
					{/if}

					{@render permissionPicker(role.id)}

					<div class="flex flex-wrap gap-3">
						<Button type="submit" variant="primary" size="sm" disabled={saving}>
							{saving ? $_('roleSettings.saving') : $_('roleSettings.save')}
						</Button>
						<Button type="button" size="sm" variant="quiet" onclick={cancel}>
							{$_('roleSettings.cancel')}
						</Button>
					</div>
				</form>
			{:else}
				{#if role.permissions.length === 0}
					<p class="mt-4 text-sm text-ink-muted">{$_('roleSettings.noPermissions')}</p>
				{:else}
					<ul class="mt-4 flex flex-wrap gap-2">
						{#each role.permissions as permission (permission)}
							<li>
								<Badge tone="neutral">{$_(`permission.${permission.replace(':', '.')}`)}</Badge>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="mt-5 flex flex-wrap items-center gap-3">
					{#if mayEdit(role)}
						<Button size="sm" onclick={() => startEdit(role)}>{$_('roleSettings.edit')}</Button>
					{/if}
					{#if !role.isSystem && mayEdit(role)}
						<Button
							size="sm"
							variant="quiet"
							disabled={role.memberCount > 0}
							onclick={() => remove(role)}
						>
							{$_('roleSettings.delete')}
						</Button>
					{/if}
					{#if isOwnerRole(role)}
						<p class="text-xs text-ink-muted">{$_('roleSettings.ownerLocked')}</p>
					{:else if !canManage}
						<!-- Already said once, at the top of the screen. -->
					{:else if !mayEdit(role)}
						<p class="text-xs text-ink-muted">{$_('roleSettings.notEditable')}</p>
					{:else if !role.isSystem && role.memberCount > 0}
						<p class="text-xs text-ink-muted">{$_('roleSettings.deleteBlocked')}</p>
					{/if}
				</div>
			{/if}
		</Card>
	{/each}
{/if}

{#snippet permissionPicker(scope: string)}
	<fieldset class="flex flex-col gap-4">
		<legend class="text-sm font-semibold">{$_('roleSettings.permissions')}</legend>

		{#each areas as group (group.area)}
			<div>
				<p class="text-eyebrow font-semibold tracking-eyebrow text-ink-muted uppercase">
					{$_(`permission.group.${group.area}`)}
				</p>
				<div class="mt-2 grid gap-2 sm:grid-cols-2">
					{#each group.permissions as permission (permission)}
						{@const id = `role-${scope}-${permission.replace(':', '-')}`}
						<div class="flex items-start gap-2.5">
							<input
								{id}
								type="checkbox"
								class="mt-1"
								disabled={!mayGrant(permission)}
								aria-describedby="{id}-hint"
								checked={draftPermissions.includes(permission)}
								onchange={(event) => toggle(permission, event.currentTarget.checked)}
							/>
							<span class="min-w-0">
								<label for={id} class="block text-sm font-semibold">
									{$_(`permission.${permission.replace(':', '.')}`)}
								</label>
								<span id="{id}-hint" class="block text-xs text-ink-muted">
									{mayGrant(permission)
										? $_(`permission.hint.${permission.replace(':', '.')}`)
										: $_('roleSettings.cannotGrant')}
								</span>
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</fieldset>
{/snippet}
