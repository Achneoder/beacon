<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Alert, Button, Card, Eyebrow, TextField } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey, ssoErrorKey } from '$lib/auth/errors';
	import { setupRequired } from '$lib/auth/setup';
	import { getPublicState, startSso } from '$lib/api/sso';
	import { validateLogin, type LoginFields } from '$lib/auth/validation';

	const FIELD_IDS: Record<keyof LoginFields, string> = {
		email: 'login-email',
		password: 'login-password'
	};

	let email = $state('');
	let password = $state('');
	let serverErrorKey = $state<string | null>(null);
	let submitting = $state(false);
	/** Hidden until the first submit, so a half-typed address is not called wrong. */
	let showErrors = $state(false);
	/**
	 * Only an unclaimed installation can create an organization, and only its very first
	 * visitor ever sees this. Everyone else joins by invitation, so the link stays hidden
	 * until the API says the instance still needs an owner.
	 */
	let offerSetup = $state(false);

	/** Null until `GET /auth/sso` answers — until then neither the button nor the
	 * password-hiding behaviour has anything to go on. */
	let ssoDisplayName = $state<string | null>(null);
	let ssoEnforced = $state(false);
	let ssoRedirecting = $state(false);

	/**
	 * The admin exemption's escape hatch: `organization:manage` never loses the
	 * password form, but they still need a way to *see* it once SSO is enforced.
	 */
	const forcePassword = $derived(page.url.searchParams.get('password') === '1');
	const showPasswordForm = $derived(!ssoEnforced || forcePassword);

	onMount(async () => {
		offerSetup = await setupRequired();

		const state = await getPublicState().catch(() => ({
			enabled: false,
			displayName: null,
			enforced: false
		}));
		ssoDisplayName = state.enabled ? state.displayName : null;
		ssoEnforced = state.enforced;

		// The sso callback failed and sent the browser back here — map its code onto
		// the same copy an enforced password login's 403 would show.
		const code = page.url.searchParams.get('error');
		if (code) serverErrorKey = ssoErrorKey(code);
	});

	const errors = $derived(validateLogin({ email, password }));

	const summaryKey = $derived(
		serverErrorKey ?? (showErrors && Object.keys(errors).length > 0 ? 'errors.checkFields' : null)
	);

	function errorFor(field: keyof LoginFields): string | undefined {
		const key = errors[field];

		return showErrors && key ? $_(key) : undefined;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		showErrors = true;
		serverErrorKey = null;

		// Without this an empty submit reaches the API and comes back as a 400, which the
		// user would see as "something went wrong" rather than "fill this in".
		if (Object.keys(errors).length > 0) {
			const field = (Object.keys(FIELD_IDS) as (keyof LoginFields)[]).find((name) => errors[name]);
			if (field) document.getElementById(FIELD_IDS[field])?.focus();

			return;
		}

		submitting = true;

		try {
			await session.login({ email: email.trim(), password });
			await goto('/');
		} catch (error) {
			serverErrorKey = errorKey(error);
		} finally {
			submitting = false;
		}
	}

	/**
	 * `POST /auth/sso/start` returns a URL rather than redirecting — `fetch` cannot
	 * usefully follow a cross-origin redirect — so this assigns `window.location` itself.
	 */
	async function signInWithSso() {
		serverErrorKey = null;
		ssoRedirecting = true;

		try {
			const { authorizationUrl } = await startSso();
			window.location.href = authorizationUrl;
		} catch (error) {
			serverErrorKey = errorKey(error);
			ssoRedirecting = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('auth.signIn')} · {$_('app.name')}</title>
</svelte:head>

<Card variant="panel" as="section">
	<Eyebrow>{$_('app.name')}</Eyebrow>
	<h1 class="mt-1.5 text-2xl font-bold tracking-tighter">{$_('auth.signIn')}</h1>
	<p class="mt-1 text-sm text-ink-muted">{$_('auth.signInSubtitle')}</p>

	{#if summaryKey}
		<Alert tone="warning" class="mt-4">{$_(summaryKey)}</Alert>
	{/if}

	{#if ssoDisplayName}
		<Button
			type="button"
			variant="primary"
			class="mt-5 w-full"
			disabled={ssoRedirecting}
			onclick={signInWithSso}
		>
			{ssoRedirecting
				? $_('auth.redirecting')
				: $_('auth.signInWith', { values: { provider: ssoDisplayName } })}
		</Button>
	{/if}

	{#if ssoDisplayName && showPasswordForm}
		<div class="my-5 flex items-center gap-3 text-2xs text-ink-muted" aria-hidden="true">
			<span class="h-px flex-1 bg-border-subtle"></span>
			{$_('auth.usePasswordDivider')}
			<span class="h-px flex-1 bg-border-subtle"></span>
		</div>
	{/if}

	{#if showPasswordForm}
		<form class="mt-6 flex flex-col gap-4" onsubmit={submit} novalidate>
			<TextField
				id={FIELD_IDS.email}
				label={$_('auth.email')}
				type="email"
				autocomplete="email"
				error={errorFor('email')}
				required
				bind:value={email}
			/>
			<TextField
				id={FIELD_IDS.password}
				label={$_('auth.password')}
				type="password"
				autocomplete="current-password"
				error={errorFor('password')}
				required
				bind:value={password}
			/>

			<Button type="submit" variant="primary" disabled={submitting}>
				{submitting ? $_('auth.submitting') : $_('auth.signIn')}
			</Button>
		</form>
	{/if}

	{#if ssoEnforced && !forcePassword}
		<p class="mt-5 text-sm text-ink-muted">
			<a href="/login?password=1" class="font-semibold text-accent-on-soft hover:underline">
				{$_('auth.usePassword')}
			</a>
		</p>
	{/if}

	{#if offerSetup && showPasswordForm}
		<p class="mt-5 text-sm text-ink-muted">
			{$_('auth.noAccount')}
			<a href="/register" class="font-semibold text-accent-on-soft hover:underline">
				{$_('auth.createOrganization')}
			</a>
		</p>
	{/if}
</Card>
