<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import type {
		CreatedInvitation,
		DepartmentSummary,
		InvitationSummary,
		UserSummary
	} from '@beacon/shared';
	import { fullName } from '@beacon/shared';
	import { Alert, Badge, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { PersonCard } from '$lib/components/people';
	import {
		createInvitation,
		listDepartments,
		listInvitations,
		listPeople,
		revokeInvitation
	} from '$lib/api/people';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import { isValidEmail } from '$lib/auth/validation';
	import { formatDate, statusKey, statusTone } from '$lib/people/labels';

	let people = $state<UserSummary[]>([]);
	let departments = $state<DepartmentSummary[]>([]);
	let invitations = $state<InvitationSummary[]>([]);
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);

	let search = $state('');
	let departmentId = $state('');

	const canManage = $derived(session.can('employee:manage'));
	const lang = $derived($locale ?? 'en');

	// Re-runs whenever a filter changes; the API does the matching, so a large
	// organization never ships its whole people list to the browser to filter locally.
	$effect(() => {
		const filter = { search: search.trim(), departmentId };
		void reload(filter);
	});

	async function reload(filter: { search: string; departmentId: string }) {
		loading = true;
		loadErrorKey = null;

		try {
			people = await listPeople(filter);
		} catch (error) {
			loadErrorKey = errorKey(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void loadSidecars();
	});

	async function loadSidecars() {
		try {
			departments = await listDepartments();
			if (canManage) invitations = await listInvitations();
		} catch {
			// The filter row and the pending list are conveniences; the table is the page.
		}
	}

	// ── The invite dialog ────────────────────────────────────────────────────────
	let inviting = $state(false);
	let inviteEmail = $state('');
	let inviteFirstName = $state('');
	let inviteLastName = $state('');
	let inviteJobTitle = $state('');
	let inviteDepartmentId = $state('');
	let inviteSending = $state(false);
	let inviteErrorKey = $state<string | null>(null);
	let created = $state<CreatedInvitation | null>(null);
	let copied = $state(false);

	function openInvite() {
		inviting = true;
		created = null;
		inviteErrorKey = null;
		copied = false;
	}

	async function sendInvite(event: SubmitEvent) {
		event.preventDefault();

		if (!isValidEmail(inviteEmail) || !inviteFirstName.trim() || !inviteLastName.trim()) {
			inviteErrorKey = 'errors.checkFields';
			return;
		}

		inviteSending = true;
		inviteErrorKey = null;

		try {
			created = await createInvitation({
				email: inviteEmail.trim(),
				firstName: inviteFirstName.trim(),
				lastName: inviteLastName.trim(),
				jobTitle: inviteJobTitle.trim() || null,
				departmentId: inviteDepartmentId || null
			});
			inviteEmail = '';
			inviteFirstName = '';
			inviteLastName = '';
			inviteJobTitle = '';
			invitations = await listInvitations();
		} catch (error) {
			inviteErrorKey = errorKey(error);
		} finally {
			inviteSending = false;
		}
	}

	async function copyLink(url: string) {
		await navigator.clipboard?.writeText(url);
		copied = true;
	}

	async function revoke(id: string) {
		await revokeInvitation(id);
		invitations = await listInvitations();
	}
</script>

<svelte:head>
	<title>{$_('people.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('people.kicker')} title={$_('people.title')} />

<div class="mt-6 flex flex-wrap items-end justify-between gap-4">
	<div class="flex flex-wrap items-end gap-3">
		<TextField
			id="people-search"
			label={$_('people.search')}
			type="search"
			class="w-full sm:w-72"
			bind:value={search}
		/>
		<div class="flex flex-col gap-1.5">
			<label for="people-department" class="text-sm font-semibold">
				{$_('profile.department')}
			</label>
			<select
				id="people-department"
				bind:value={departmentId}
				class="rounded-control border border-border-default bg-surface px-3.5 py-2.5 text-sm"
			>
				<option value="">{$_('people.allDepartments')}</option>
				{#each departments as department (department.id)}
					<option value={department.id}>{department.name}</option>
				{/each}
			</select>
		</div>
	</div>

	{#if canManage}
		<Button variant="primary" size="sm" onclick={openInvite}>{$_('people.invite')}</Button>
	{/if}
</div>

{#if inviting && canManage}
	<Card variant="panel" as="section" class="mt-5">
		<h2 class="text-sm font-bold">{$_('people.inviteTitle')}</h2>
		<p class="mt-1 text-xs text-ink-muted">{$_('people.inviteHint')}</p>

		{#if created}
			<Alert tone={created.emailSent ? 'success' : 'warning'} live="status" class="mt-4">
				{created.emailSent
					? $_('people.inviteEmailed', { values: { email: created.email } })
					: $_('people.inviteNotEmailed', { values: { email: created.email } })}
			</Alert>
			<!--
				Shown once and never again: the server stores only the token's hash. Kept even
				when the email went out, because an invitee who never receives it has no other
				way back in — the token cannot be re-read from the database.
			-->
			<p class="mt-3 text-xs text-ink-muted">{$_('people.inviteLinkHint')}</p>
			<div class="mt-2 flex flex-wrap items-center gap-3">
				<code
					class="min-w-0 flex-1 truncate rounded-control bg-surface-muted px-3 py-2 font-mono text-xs"
				>
					{created.acceptUrl}
				</code>
				<Button size="sm" onclick={() => copyLink(created!.acceptUrl)}>
					{copied ? $_('people.inviteCopied') : $_('people.inviteCopy')}
				</Button>
			</div>
		{:else}
			<form class="mt-4 flex flex-col gap-4" onsubmit={sendInvite} novalidate>
				{#if inviteErrorKey}
					<Alert tone="warning">{$_(inviteErrorKey)}</Alert>
				{/if}

				<div class="grid gap-4 sm:grid-cols-2">
					<TextField
						id="invite-first-name"
						label={$_('register.firstName')}
						autocomplete="given-name"
						required
						bind:value={inviteFirstName}
					/>
					<TextField
						id="invite-last-name"
						label={$_('register.lastName')}
						autocomplete="family-name"
						required
						bind:value={inviteLastName}
					/>
				</div>
				<TextField
					id="invite-email"
					label={$_('auth.email')}
					type="email"
					autocomplete="email"
					required
					bind:value={inviteEmail}
				/>
				<TextField
					id="invite-job-title"
					label={$_('people.columnRole')}
					bind:value={inviteJobTitle}
				/>

				<div class="flex gap-3">
					<Button type="submit" variant="primary" size="sm" disabled={inviteSending}>
						{inviteSending ? $_('people.inviteSending') : $_('people.inviteSend')}
					</Button>
					<Button size="sm" variant="quiet" onclick={() => (inviting = false)}>
						{$_('profile.cancel')}
					</Button>
				</div>
			</form>
		{/if}
	</Card>
{/if}

<Card variant="panel" as="section" class="mt-6">
	{#if loadErrorKey}
		<Alert tone="warning">{$_(loadErrorKey)}</Alert>
	{:else if loading}
		<p class="text-sm text-ink-muted">{$_('people.loading')}</p>
	{:else if people.length === 0}
		<p class="text-sm text-ink-muted">{$_('people.empty')}</p>
	{:else}
		<p class="text-xs text-ink-muted">{$_('people.count', { values: { count: people.length } })}</p>

		<div class="mt-4 overflow-x-auto">
			<table class="w-full min-w-[42rem] border-collapse text-left">
				<thead>
					<tr
						class="border-b border-border-subtle text-eyebrow tracking-eyebrow text-ink-muted uppercase"
					>
						<th scope="col" class="py-2 font-semibold">{$_('people.columnName')}</th>
						<th scope="col" class="py-2 font-semibold">{$_('people.columnDepartment')}</th>
						<th scope="col" class="py-2 font-semibold">{$_('people.columnStatus')}</th>
						<th scope="col" class="py-2 text-right font-semibold">
							{$_('profile.employeeNumber')}
						</th>
					</tr>
				</thead>
				<tbody>
					{#each people as person (person.id)}
						<tr class="border-b border-border-subtle last:border-0">
							<td class="py-3">
								<a
									href="/people/{person.id}"
									class="rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
								>
									<PersonCard name={fullName(person)} subtitle={person.jobTitle} size="sm" />
								</a>
							</td>
							<td class="py-3 text-sm text-ink-muted">{person.departmentName ?? '—'}</td>
							<td class="py-3">
								<Badge tone={statusTone(person.status)}>{$_(statusKey(person.status))}</Badge>
							</td>
							<td class="py-3 text-right font-mono text-xs text-ink-muted">
								{person.employeeNumber ?? '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

{#if canManage}
	<Card as="section" class="mt-6">
		<h2 class="text-sm font-bold">{$_('people.pending')}</h2>
		{#if invitations.length === 0}
			<p class="mt-2 text-xs text-ink-muted">{$_('people.pendingEmpty')}</p>
		{:else}
			<ul class="mt-4 flex flex-col gap-3">
				{#each invitations as invitation (invitation.id)}
					<li class="flex flex-wrap items-center justify-between gap-3">
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold">
								{fullName(invitation)}
							</span>
							<span class="block truncate text-xs text-ink-muted">{invitation.email}</span>
						</span>
						<span class="flex items-center gap-3">
							{#if invitation.acceptedAt}
								<Badge tone="success">{$_('people.accepted')}</Badge>
							{:else if invitation.isExpired}
								<Badge tone="warning">{$_('people.expired')}</Badge>
							{:else}
								<span class="font-mono text-xs text-ink-muted">
									{$_('people.expiresOn', {
										values: { date: formatDate(invitation.expiresAt.slice(0, 10), lang) }
									})}
								</span>
							{/if}
							{#if !invitation.acceptedAt}
								<Button size="sm" variant="quiet" onclick={() => revoke(invitation.id)}>
									{$_('people.revoke')}
								</Button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
{/if}
