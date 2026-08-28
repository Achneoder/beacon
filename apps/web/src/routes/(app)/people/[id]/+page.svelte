<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { page } from '$app/state';
	import type { UserDetail } from '@beacon/shared';
	import { fullName } from '@beacon/shared';
	import { Alert, Badge, Button, Card } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { Field, PersonCard } from '$lib/components/people';
	import { disablePerson, getPerson } from '$lib/api/people';
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
	<Card variant="panel" as="section" class="mt-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<PersonCard name={fullName(person)} subtitle={person.jobTitle} size="lg" />
			<div class="flex items-center gap-2">
				<Badge tone={statusTone(person.status)}>{$_(statusKey(person.status))}</Badge>
				<Badge tone="neutral" class="font-mono">{person.employeeNumber ?? notSet}</Badge>
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
