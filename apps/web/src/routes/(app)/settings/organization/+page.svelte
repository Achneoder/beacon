<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { locale } from 'svelte-i18n';
	import { SUPPORTED_LOCALES, type LocaleCode } from '@beacon/shared';
	import type {
		AbsenceTypeSummary,
		DepartmentSummary,
		HolidaySummary,
		OrganizationSummary,
		RoleSummary
	} from '@beacon/shared';
	import { Alert, Badge, Button, Card, SelectField, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { api, apiSend } from '$lib/api/client';
	import { createDepartment, deleteDepartment, listDepartments } from '$lib/api/people';
	import {
		createHoliday,
		deleteHoliday,
		listAllAbsenceTypes,
		listHolidays,
		retireAbsenceType
	} from '$lib/api/absences';
	import { reindexSearch } from '$lib/api/search';
	import { timezoneGroups } from '$lib/time/zone';
	import { formatDate, toneOf, typeName } from '$lib/absence/labels';
	import { errorKey } from '$lib/auth/errors';
	import { session } from '$lib/auth/session.svelte';

	let organization = $state<OrganizationSummary | null>(null);
	let roles = $state<RoleSummary[]>([]);
	let departments = $state<DepartmentSummary[]>([]);
	let loadErrorKey = $state<string | null>(null);

	let name = $state('');
	let timezone = $state('');
	let defaultLocale = $state<LocaleCode>('en');
	let saving = $state(false);
	let saved = $state(false);
	let saveErrorKey = $state<string | null>(null);

	let newDepartment = $state('');
	let departmentErrorKey = $state<string | null>(null);
	let departmentActionErrorKey = $state<string | null>(null);

	/**
	 * Absence types and public holidays live under organization settings rather than
	 * behind an `absence:manage` permission of their own — they are settings, and the
	 * permission union only grows when a phase says so.
	 */
	let absenceTypes = $state<AbsenceTypeSummary[]>([]);
	let typeActionErrorKey = $state<string | null>(null);
	let holidays = $state<HolidaySummary[]>([]);
	let holidayDate = $state('');
	let holidayName = $state('');
	let holidayErrorKey = $state<string | null>(null);
	let holidayActionErrorKey = $state<string | null>(null);

	const lang = $derived($locale ?? 'en');
	const year = new Date().getUTCFullYear();

	// Chosen from the list `Intl` will actually accept, not typed: the organization's
	// zone is what everyone without one of their own is measured against, and a typo
	// there used to save cleanly and misplace every clock-in. Built from the saved
	// value so a zone this browser cannot name survives opening the form.
	const zones = $derived(timezoneGroups(organization?.timezone));

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
			absenceTypes = await listAllAbsenceTypes();
			holidays = await listHolidays(`${year}-01-01`, `${year}-12-31`);
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
				timezone,
				defaultLocale
			});
			saved = true;
			// The default language is what everyone who has not chosen one of their own
			// sees, quite possibly including whoever just changed it — so re-read the
			// session rather than making them reload to find out whether it took. A
			// failure here has not undone the save and must not be reported as one.
			await session.reload().catch(() => {});
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
		departmentActionErrorKey = null;
		try {
			await deleteDepartment(id);
			departments = departments.filter((department) => department.id !== id);
		} catch (error) {
			departmentActionErrorKey = errorKey(error);
		}
	}

	/** Retiring, never deleting — old requests must keep naming their type. */
	async function retireType(id: string) {
		typeActionErrorKey = null;
		try {
			const updated = await retireAbsenceType(id);
			absenceTypes = absenceTypes.map((type) => (type.id === id ? updated : type));
		} catch (error) {
			typeActionErrorKey = errorKey(error);
		}
	}

	async function addHoliday(event: SubmitEvent) {
		event.preventDefault();
		if (!holidayDate || !holidayName.trim()) return;

		holidayErrorKey = null;
		try {
			const created = await createHoliday({ date: holidayDate, name: holidayName.trim() });
			holidays = [...holidays, created].sort((left, right) => left.date.localeCompare(right.date));
			holidayDate = '';
			holidayName = '';
		} catch (error) {
			holidayErrorKey = errorKey(error);
		}
	}

	async function removeHoliday(id: string) {
		holidayActionErrorKey = null;
		try {
			await deleteHoliday(id);
			holidays = holidays.filter((holiday) => holiday.id !== id);
		} catch (error) {
			holidayActionErrorKey = errorKey(error);
		}
	}

	/**
	 * The search index is derived state and nothing backfills it at boot, so a fresh
	 * container or a restored volume leaves search silently empty. This is the repair,
	 * and it lives here rather than anywhere automatic because rebuilding an entire
	 * organization is an administrator's decision, not a side effect of starting up.
	 */
	let reindexing = $state(false);
	let reindexedMessage = $state<string | null>(null);
	let reindexErrorKey = $state<string | null>(null);

	async function rebuildIndex() {
		reindexing = true;
		reindexedMessage = null;
		reindexErrorKey = null;

		try {
			const counts = await reindexSearch();
			reindexedMessage = $_('search.reindexed', { values: counts });
		} catch {
			reindexErrorKey = 'search.reindexFailed';
		} finally {
			reindexing = false;
		}
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
				<SelectField
					id="settings-timezone"
					label={$_('org.timezone')}
					hint={$_('org.timezoneHint')}
					bind:value={timezone}
				>
					{#each zones as group (group.region)}
						<optgroup label={group.region}>
							{#each group.zones as zone (zone.value)}
								<option value={zone.value}>{zone.label}</option>
							{/each}
						</optgroup>
					{/each}
				</SelectField>
				<SelectField
					id="settings-locale"
					label={$_('org.defaultLocale')}
					hint={$_('org.defaultLocaleHint')}
					bind:value={defaultLocale}
				>
					{#each SUPPORTED_LOCALES as code (code)}
						<option value={code}>{$_(`org.locale.${code}`)}</option>
					{/each}
				</SelectField>
			</div>

			<Button type="submit" variant="primary" size="sm" class="self-start" disabled={saving}>
				{saving ? $_('settings.saving') : $_('settings.save')}
			</Button>
		</form>
	</Card>

	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('settings.departments')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.departmentsHint')}</p>

		{#if departmentActionErrorKey}
			<Alert tone="warning" class="mt-3">{$_(departmentActionErrorKey)}</Alert>
		{/if}

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
		<h2 class="text-sm font-bold">{$_('settings.absenceTypes')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.absenceTypesHint')}</p>

		{#if typeActionErrorKey}
			<Alert tone="warning" class="mt-3">{$_(typeActionErrorKey)}</Alert>
		{/if}

		<ul class="mt-4 flex flex-col gap-3">
			{#each absenceTypes as type (type.id)}
				<li class="flex flex-wrap items-center justify-between gap-3">
					<span class="flex flex-wrap items-center gap-2">
						<Badge tone={toneOf(type.colorRole)}>{typeName(type, $_)}</Badge>
						{#if type.deductsFromQuota}
							<span class="text-xs text-ink-muted">{$_('settings.deducts')}</span>
						{/if}
						{#if type.countsAsWork}
							<span class="text-xs text-ink-muted">{$_('settings.countsAsWork')}</span>
						{/if}
						{#if !type.paid}
							<span class="text-xs text-ink-muted">{$_('settings.paid')}: —</span>
						{/if}
					</span>
					{#if type.active}
						<Button size="sm" variant="quiet" onclick={() => retireType(type.id)}>
							{$_('settings.retire')}
						</Button>
					{:else}
						<Badge tone="neutral">{$_('settings.retired')}</Badge>
					{/if}
				</li>
			{/each}
		</ul>
	</Card>

	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('settings.holidays')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.holidaysHint')}</p>

		{#if holidayActionErrorKey}
			<Alert tone="warning" class="mt-3">{$_(holidayActionErrorKey)}</Alert>
		{/if}

		{#if holidays.length === 0}
			<p class="mt-4 text-sm text-ink-muted">{$_('settings.noHolidays')}</p>
		{:else}
			<ul class="mt-4 flex flex-col gap-2">
				{#each holidays as holiday (holiday.id)}
					<li class="flex flex-wrap items-center justify-between gap-3">
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold">{holiday.name}</span>
							<span class="block font-mono text-xs text-ink-muted">
								{formatDate(holiday.date, lang)}
							</span>
						</span>
						<Button size="sm" variant="quiet" onclick={() => removeHoliday(holiday.id)}>
							{$_('settings.delete')}
						</Button>
					</li>
				{/each}
			</ul>
		{/if}

		<form class="mt-5 flex flex-wrap items-end gap-3" onsubmit={addHoliday} novalidate>
			<label class="flex flex-col gap-1.5 text-sm font-semibold">
				{$_('settings.holidayDate')}
				<input
					type="date"
					bind:value={holidayDate}
					class="rounded-control border border-border-default bg-surface px-3 py-2 font-mono text-sm font-normal"
				/>
			</label>
			<TextField
				id="settings-new-holiday"
				label={$_('settings.holidayName')}
				class="w-full sm:w-72"
				error={holidayErrorKey ? $_(holidayErrorKey) : undefined}
				bind:value={holidayName}
			/>
			<Button type="submit" size="sm">{$_('settings.addHoliday')}</Button>
		</form>
	</Card>

	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('search.reindex')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('search.reindexHint')}</p>

		{#if reindexedMessage}
			<Alert tone="success" live="status" class="mt-4">{reindexedMessage}</Alert>
		{/if}
		{#if reindexErrorKey}
			<Alert tone="warning" class="mt-4">{$_(reindexErrorKey)}</Alert>
		{/if}

		<Button size="sm" class="mt-5" disabled={reindexing} onclick={rebuildIndex}>
			{reindexing ? $_('search.reindexing') : $_('search.reindex')}
		</Button>
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

	<Card variant="panel" as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('settings.ssoTitle')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('settings.ssoHint')}</p>

		<Button size="sm" class="mt-5" href="/settings/sso">
			{$_('settings.ssoManage')}
		</Button>
	</Card>
{/if}
