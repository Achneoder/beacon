<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import type { LocaleCode, UserDetail } from '@beacon/shared';
	import { Alert, Badge, Button, Card, SelectField, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { Field, PersonCard } from '$lib/components/people';
	import { fullName, SUPPORTED_LOCALES } from '@beacon/shared';
	import { timezoneGroups } from '$lib/time/zone';
	import { getOwnProfile, updateOwnProfile } from '$lib/api/people';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import { contractKey, formatDate, locationLine, workLocationKey } from '$lib/people/labels';

	let profile = $state<UserDetail | null>(null);
	let loadErrorKey = $state<string | null>(null);
	let editing = $state(false);
	let saving = $state(false);
	let saved = $state(false);
	let saveErrorKey = $state<string | null>(null);

	// The three fields a person may change about themselves. Everything else on this
	// screen is employment data, maintained by whoever holds employee:manage.
	//
	// Language and zone are chosen from a list rather than typed: both are stored
	// values other code formats against, and a plausible-looking typo — `de-DE`,
	// `Europe/Berlon` — used to save cleanly and then quietly change nothing, or
	// the wrong thing. An empty string is "no choice of my own", which the API
	// stores as null and reads as the organization's setting.
	let phone = $state('');
	let language = $state<LocaleCode | ''>('');
	let timezone = $state('');

	// Built from the saved value, so a zone this browser cannot name is still offered
	// back rather than silently rewritten by opening the form.
	const zones = $derived(timezoneGroups(profile?.timezone));

	const lang = $derived($locale ?? 'en');
	const notSet = $derived($_('people.notSet'));

	$effect(() => {
		void load();
	});

	async function load() {
		try {
			profile = await getOwnProfile();
		} catch (error) {
			loadErrorKey = errorKey(error);
		}
	}

	function startEditing() {
		phone = profile?.phone ?? '';
		language = profile?.locale ?? '';
		timezone = profile?.timezone ?? '';
		saveErrorKey = null;
		saved = false;
		editing = true;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saveErrorKey = null;

		try {
			profile = await updateOwnProfile({
				phone: phone.trim() || null,
				locale: language || null,
				timezone: timezone || null
			});
			// The header reads the zone off the session and the whole app renders in its
			// language, so re-read it. `SessionUser.locale` is resolved per request against
			// the organization's default, which is why clearing a choice needs the API to
			// answer rather than a local patch. A failure here has not undone the save.
			await session.reload().catch(() => {});
			editing = false;
			saved = true;
		} catch (error) {
			saveErrorKey = errorKey(error);
		} finally {
			saving = false;
		}
	}

	const location = $derived(
		profile
			? locationLine(
					profile.office,
					workLocationKey(profile.workLocation)
						? $_(workLocationKey(profile.workLocation) as string)
						: null
				)
			: null
	);
	const contract = $derived(
		profile && contractKey(profile.contractType)
			? $_(contractKey(profile.contractType) as string)
			: null
	);
</script>

<svelte:head>
	<title>{$_('profile.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('profile.kicker')} title={$_('profile.title')} />

{#if loadErrorKey}
	<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
{:else if !profile}
	<p class="mt-6 text-sm text-ink-muted">{$_('people.loading')}</p>
{:else}
	{#if saved}
		<Alert tone="success" live="status" class="mt-6">{$_('profile.saved')}</Alert>
	{/if}

	<Card variant="panel" as="section" class="mt-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<PersonCard name={fullName(profile)} subtitle={profile.jobTitle} size="lg" />
			<div class="flex items-center gap-2">
				<Badge tone="neutral" class="font-mono">{profile.employeeNumber ?? notSet}</Badge>
				{#if !editing}
					<Button size="sm" variant="ghost" onclick={startEditing}>{$_('profile.edit')}</Button>
				{/if}
			</div>
		</div>

		<h2 class="mt-8 text-sm font-bold">{$_('profile.details')}</h2>
		<dl class="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
			<Field
				label={$_('profile.employeeNumber')}
				value={profile.employeeNumber}
				placeholder={notSet}
				mono
			/>
			<Field label={$_('profile.email')} value={profile.email} placeholder={notSet} />
			<Field label={$_('profile.department')} value={profile.departmentName} placeholder={notSet} />
			<Field label={$_('profile.team')} value={profile.teamName} placeholder={notSet} />
			<Field
				label={$_('profile.startDate')}
				value={formatDate(profile.startsOn, lang)}
				placeholder={notSet}
				mono
			/>
			<Field label={$_('profile.contract')} value={contract} placeholder={notSet} />
			<Field label={$_('profile.location')} value={location} placeholder={notSet} />
			<Field label={$_('profile.phone')} value={profile.phone} placeholder={notSet} mono />
		</dl>

		{#if editing}
			<form class="mt-8 border-t border-border-subtle pt-6" onsubmit={save} novalidate>
				<p class="text-xs text-ink-muted">{$_('profile.editable')}</p>

				{#if saveErrorKey}
					<Alert tone="warning" class="mt-4">{$_(saveErrorKey)}</Alert>
				{/if}

				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<TextField
						id="profile-phone"
						label={$_('profile.phone')}
						type="tel"
						autocomplete="tel"
						bind:value={phone}
					/>
					<SelectField
						id="profile-language"
						label={$_('profile.language')}
						hint={$_('profile.followsOrganization')}
						bind:value={language}
					>
						<option value="">{$_('profile.organizationDefault')}</option>
						{#each SUPPORTED_LOCALES as code (code)}
							<option value={code}>{$_(`org.locale.${code}`)}</option>
						{/each}
					</SelectField>
					<SelectField
						id="profile-timezone"
						label={$_('profile.timezone')}
						hint={$_('profile.followsOrganization')}
						bind:value={timezone}
					>
						<option value="">{$_('profile.organizationDefault')}</option>
						{#each zones as group (group.region)}
							<optgroup label={group.region}>
								{#each group.zones as zone (zone.value)}
									<option value={zone.value}>{zone.label}</option>
								{/each}
							</optgroup>
						{/each}
					</SelectField>
				</div>

				<div class="mt-5 flex gap-3">
					<Button type="submit" variant="primary" size="sm" disabled={saving}>
						{saving ? $_('profile.saving') : $_('profile.save')}
					</Button>
					<Button size="sm" variant="quiet" onclick={() => (editing = false)}>
						{$_('profile.cancel')}
					</Button>
				</div>
			</form>
		{/if}
	</Card>

	<div class="mt-6 grid gap-6 lg:grid-cols-3">
		<!-- Phase 2 fills this card with the schedule, weekly hours and core times. -->
		<Card as="section">
			<h2 class="text-sm font-bold">{$_('profile.workModel')}</h2>
			<p class="mt-2 text-xs text-ink-muted">{$_('profile.workModelPending')}</p>
		</Card>

		<Card as="section">
			<h2 class="text-sm font-bold">{$_('profile.reportsTo')}</h2>
			{#if profile.managerName}
				<div class="mt-4">
					<PersonCard name={profile.managerName} subtitle={profile.managerJobTitle} />
				</div>
			{:else}
				<p class="mt-2 text-xs text-ink-muted">{$_('profile.noManager')}</p>
			{/if}
		</Card>

		<Card as="section">
			<h2 class="text-sm font-bold">{$_('profile.access')}</h2>
			<!-- Display only: session.can() still decides what the UI offers. -->
			<ul class="mt-4 flex flex-wrap gap-2">
				{#each profile.roles as role (role.id)}
					<li><Badge tone="accent">{$_(`roles.${role.key}`, { default: role.name })}</Badge></li>
				{/each}
			</ul>
			<p class="mt-3 text-xs text-ink-muted">{$_('profile.accessHint')}</p>
		</Card>
	</div>
{/if}
