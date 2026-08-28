<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type {
		DepartmentSummary,
		DocumentAccessLevel,
		DocumentAccessSubject,
		DocumentAccessSummary,
		RoleSummary,
		UserSummary
	} from '@beacon/shared';
	import { Button } from '$lib/components/ui';
	import { api } from '$lib/api/client';
	import { listDepartments, listPeople } from '$lib/api/people';

	type Props = {
		access: DocumentAccessSummary[];
		busy: boolean;
		onGrant: (
			subject: DocumentAccessSubject,
			subjectId: string,
			level: DocumentAccessLevel
		) => void;
		onRevoke: (accessId: string) => void;
	};

	let { access, busy, onGrant, onRevoke }: Props = $props();

	let people = $state<UserSummary[]>([]);
	let departments = $state<DepartmentSummary[]>([]);
	let roles = $state<RoleSummary[]>([]);
	let loadedPickers = $state(false);

	let subject = $state<DocumentAccessSubject>('user');
	let subjectId = $state('');
	let level = $state<DocumentAccessLevel>('read');

	$effect(() => {
		if (loadedPickers) return;
		loadedPickers = true;

		void Promise.all([
			listPeople(),
			listDepartments(),
			api<RoleSummary[]>('/organizations/current/roles')
		]).then(([p, d, r]) => {
			people = p;
			departments = d;
			roles = r;
		});
	});

	const options = $derived(
		subject === 'user'
			? people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))
			: subject === 'department'
				? departments.map((d) => ({ id: d.id, name: d.name }))
				: roles.map((r) => ({ id: r.id, name: r.name }))
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!subjectId) return;

		onGrant(subject, subjectId, level);
		subjectId = '';
	}
</script>

<div>
	<h3 class="text-sm font-bold">{$_('documents.access.title')}</h3>

	{#if access.length === 0}
		<p class="mt-2 text-xs text-ink-muted">{$_('documents.access.empty')}</p>
	{:else}
		<ul class="mt-3 flex flex-col gap-2">
			{#each access as grant (grant.id)}
				<li class="flex items-center justify-between gap-2 text-sm">
					<span class="min-w-0 truncate">
						{grant.subjectName}
						<span class="text-xs text-ink-muted">
							· {$_(
								grant.level === 'write'
									? 'documents.access.levelWrite'
									: 'documents.access.levelRead'
							)}
						</span>
					</span>
					<Button size="sm" variant="quiet" disabled={busy} onclick={() => onRevoke(grant.id)}>
						{$_('documents.access.revoke')}
					</Button>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={submit}>
		<div class="flex flex-col gap-1.5">
			<label for="access-subject" class="text-xs font-semibold"
				>{$_('documents.access.subjectType')}</label
			>
			<select
				id="access-subject"
				bind:value={subject}
				onchange={() => (subjectId = '')}
				class="rounded-control border border-border-default bg-surface px-3 py-2 text-sm"
			>
				<option value="user">{$_('documents.access.subjectUser')}</option>
				<option value="department">{$_('documents.access.subjectDepartment')}</option>
				<option value="role">{$_('documents.access.subjectRole')}</option>
			</select>
		</div>
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<label for="access-subject-id" class="sr-only">{$_('documents.access.subjectType')}</label>
			<select
				id="access-subject-id"
				bind:value={subjectId}
				class="w-full rounded-control border border-border-default bg-surface px-3 py-2 text-sm"
			>
				<option value=""></option>
				{#each options as option (option.id)}
					<option value={option.id}>{option.name}</option>
				{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="access-level" class="text-xs font-semibold">{$_('documents.access.level')}</label>
			<select
				id="access-level"
				bind:value={level}
				class="rounded-control border border-border-default bg-surface px-3 py-2 text-sm"
			>
				<option value="read">{$_('documents.access.levelRead')}</option>
				<option value="write">{$_('documents.access.levelWrite')}</option>
			</select>
		</div>
		<Button type="submit" size="sm" variant="primary" disabled={busy || !subjectId}>
			{$_('documents.access.grant')}
		</Button>
	</form>
</div>
