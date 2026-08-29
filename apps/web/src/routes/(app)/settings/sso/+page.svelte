<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import type { SsoSettings } from '@beacon/shared';
	import { Alert, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import { ApiError } from '$lib/api/client';
	import { deleteSettings, getSettings, saveSettings, testSettings } from '$lib/api/sso';
	import { errorKey } from '$lib/auth/errors';

	let settings = $state<SsoSettings | null>(null);
	/** Distinguishes "still loading" from "nothing configured yet" — a 404 is routine here. */
	let loaded = $state(false);
	let loadErrorKey = $state<string | null>(null);

	let displayName = $state('');
	let issuerUrl = $state('');
	let clientId = $state('');
	let clientSecret = $state('');
	let scopes = $state('openid email profile');
	let emailClaim = $state('email');
	let allowedDomainsText = $state('');
	let enabled = $state(false);
	let enforced = $state(false);

	let saving = $state(false);
	let saveErrorKey = $state<string | null>(null);
	let saved = $state(false);

	let testing = $state(false);
	let testErrorKey = $state<string | null>(null);
	let testSucceededWith = $state<string | null>(null);

	let deleting = $state(false);
	let deleteErrorKey = $state<string | null>(null);

	let copied = $state(false);

	const lang = $derived($locale ?? 'en');

	$effect(() => {
		void load();
	});

	function applyLoaded(loadedSettings: SsoSettings) {
		settings = loadedSettings;
		displayName = loadedSettings.displayName;
		issuerUrl = loadedSettings.issuerUrl;
		clientId = loadedSettings.clientId;
		clientSecret = '';
		scopes = loadedSettings.scopes;
		emailClaim = loadedSettings.emailClaim;
		allowedDomainsText = loadedSettings.allowedDomains.join('\n');
		enabled = loadedSettings.enabled;
		enforced = loadedSettings.enforced;
	}

	async function load() {
		try {
			applyLoaded(await getSettings());
		} catch (error) {
			// No provider yet is the ordinary first-run state, not a failure to report.
			if (!(error instanceof ApiError) || error.status !== 404) {
				loadErrorKey = errorKey(error);
			}
		} finally {
			loaded = true;
		}
	}

	function domainsFromText(): string[] {
		return allowedDomainsText
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saveErrorKey = null;
		saved = false;

		try {
			applyLoaded(
				await saveSettings({
					displayName: displayName.trim(),
					issuerUrl: issuerUrl.trim(),
					clientId: clientId.trim(),
					clientSecret: clientSecret.trim() || undefined,
					scopes: scopes.trim(),
					emailClaim: emailClaim.trim(),
					allowedDomains: domainsFromText(),
					enabled,
					enforced
				})
			);
			saved = true;
		} catch (error) {
			saveErrorKey = errorKey(error);
		} finally {
			saving = false;
		}
	}

	async function testConnection() {
		testing = true;
		testErrorKey = null;
		testSucceededWith = null;

		try {
			const result = await testSettings({
				issuerUrl: issuerUrl.trim(),
				clientId: clientId.trim(),
				clientSecret: clientSecret.trim() || undefined
			});
			testSucceededWith = result.issuer;
		} catch (error) {
			testErrorKey = errorKey(error);
		} finally {
			testing = false;
		}
	}

	async function removeProvider() {
		if (!confirm($_('sso.deleteConfirm'))) return;

		deleting = true;
		deleteErrorKey = null;

		try {
			await deleteSettings();
			settings = null;
			displayName = '';
			issuerUrl = '';
			clientId = '';
			clientSecret = '';
			scopes = 'openid email profile';
			emailClaim = 'email';
			allowedDomainsText = '';
			enabled = false;
			enforced = false;
		} catch (error) {
			deleteErrorKey = errorKey(error);
		} finally {
			deleting = false;
		}
	}

	async function copyRedirectUri() {
		if (!settings) return;
		await navigator.clipboard?.writeText(settings.redirectUri);
		copied = true;
	}

	function formatTimestamp(iso: string): string {
		return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(iso)
		);
	}
</script>

<svelte:head>
	<title>{$_('sso.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('sso.kicker')} title={$_('sso.title')} />

<p class="mt-3 text-sm">
	<a href="/settings/organization" class="font-semibold text-accent-on-soft hover:underline">
		&larr; {$_('sso.back')}
	</a>
</p>

{#if !loaded}
	<p class="mt-6 text-sm text-ink-muted">{$_('sso.loading')}</p>
{:else}
	{#if loadErrorKey}
		<Alert tone="warning" class="mt-6">{$_(loadErrorKey)}</Alert>
	{:else if !settings}
		<Alert tone="info" class="mt-6" live="none">{$_('sso.notConfigured')}</Alert>
	{/if}

	<Card variant="panel" as="section" class="mt-6">
		<form class="flex flex-col gap-5" onsubmit={save} novalidate>
			{#if saved}
				<Alert tone="success" live="status">{$_('sso.saved')}</Alert>
			{/if}
			{#if saveErrorKey}
				<Alert tone="warning">{$_(saveErrorKey)}</Alert>
			{/if}

			<TextField
				id="sso-display-name"
				label={$_('sso.displayName')}
				hint={$_('sso.displayNameHint', { values: { example: 'Okta' } })}
				required
				bind:value={displayName}
			/>

			<TextField
				id="sso-issuer-url"
				label={$_('sso.issuerUrl')}
				hint={$_('sso.issuerUrlHint')}
				type="url"
				required
				bind:value={issuerUrl}
			/>

			<div class="grid gap-4 sm:grid-cols-2">
				<TextField id="sso-client-id" label={$_('sso.clientId')} required bind:value={clientId} />
				<TextField
					id="sso-client-secret"
					label={$_('sso.clientSecret')}
					type="password"
					autocomplete="off"
					placeholder={settings?.hasClientSecret ? $_('sso.clientSecretPlaceholder') : undefined}
					hint={settings?.hasClientSecret ? $_('sso.clientSecretHint') : undefined}
					bind:value={clientSecret}
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<TextField id="sso-scopes" label={$_('sso.scopes')} bind:value={scopes} />
				<TextField id="sso-email-claim" label={$_('sso.emailClaim')} bind:value={emailClaim} />
			</div>

			<div class="flex flex-col gap-1.5">
				<label class="text-sm font-semibold text-ink" for="sso-allowed-domains">
					{$_('sso.allowedDomains')}
				</label>
				<textarea
					id="sso-allowed-domains"
					rows="3"
					aria-describedby="sso-allowed-domains-hint"
					class="w-full rounded-control border border-border-default bg-surface px-3.5 py-2.5 font-mono text-sm text-ink transition-colors hover:border-ink-muted"
					bind:value={allowedDomainsText}
				></textarea>
				<p id="sso-allowed-domains-hint" class="text-xs text-ink-muted">
					{$_('sso.allowedDomainsHint')}
				</p>
			</div>

			{#if settings}
				<div class="flex flex-col gap-1.5 text-sm font-semibold text-ink">
					{$_('sso.redirectUri')}
					<div class="flex flex-wrap items-center gap-3">
						<code class="rounded-control bg-surface-muted px-3 py-2 font-mono text-xs break-all">
							{settings.redirectUri}
						</code>
						<Button size="sm" variant="quiet" type="button" onclick={copyRedirectUri}>
							{copied ? $_('sso.copied') : $_('sso.copy')}
						</Button>
					</div>
					<span class="text-xs font-normal text-ink-muted">{$_('sso.redirectUriHint')}</span>
				</div>
			{/if}

			<div class="flex flex-wrap items-end justify-between gap-3">
				<div class="flex flex-col gap-2">
					{#if testErrorKey}
						<Alert tone="warning">{$_(testErrorKey)}</Alert>
					{/if}
					{#if testSucceededWith}
						<Alert tone="success" live="status">
							{$_('sso.testSucceeded', { values: { issuer: testSucceededWith } })}
						</Alert>
					{/if}
					<p class="text-xs text-ink-muted">
						{settings?.lastTestedAt
							? $_('sso.lastTested', { values: { date: formatTimestamp(settings.lastTestedAt) } })
							: $_('sso.neverTested')}
					</p>
				</div>
				<Button
					size="sm"
					type="button"
					disabled={testing || !issuerUrl.trim() || !clientId.trim()}
					onclick={testConnection}
				>
					{testing ? $_('sso.testing') : $_('sso.testConnection')}
				</Button>
			</div>

			<div class="flex flex-col gap-3 border-t border-border-subtle pt-4">
				<div class="flex items-start gap-2.5">
					<input
						id="sso-enabled"
						type="checkbox"
						class="mt-1"
						aria-describedby="sso-enabled-hint"
						bind:checked={enabled}
					/>
					<label for="sso-enabled" class="text-sm font-semibold">{$_('sso.enabled')}</label>
				</div>
				<p id="sso-enabled-hint" class="pl-[26px] text-xs text-ink-muted">
					{$_('sso.enabledHint')}
				</p>

				<div class="flex items-start gap-2.5">
					<input
						id="sso-enforced"
						type="checkbox"
						class="mt-1"
						disabled={!enabled}
						aria-describedby="sso-enforced-hint"
						bind:checked={enforced}
					/>
					<label for="sso-enforced" class="text-sm font-semibold">{$_('sso.enforced')}</label>
				</div>
				<p id="sso-enforced-hint" class="pl-[26px] text-xs text-ink-muted">
					{$_('sso.enforcedHint')}
				</p>
			</div>

			<div class="flex items-center gap-3">
				<Button type="submit" variant="primary" disabled={saving}>
					{saving ? $_('sso.saving') : $_('sso.save')}
				</Button>

				{#if settings}
					<Button variant="quiet" type="button" disabled={deleting} onclick={removeProvider}>
						{$_('sso.delete')}
					</Button>
				{/if}
			</div>

			{#if deleteErrorKey}
				<Alert tone="warning">{$_(deleteErrorKey)}</Alert>
			{/if}
		</form>
	</Card>
{/if}
