<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { Alert, Button, Card, Eyebrow, TextField } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import { setupRequired } from '$lib/auth/setup';
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

	onMount(async () => {
		offerSetup = await setupRequired();
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
</script>

<svelte:head>
	<title>{$_('auth.signIn')} · {$_('app.name')}</title>
</svelte:head>

<Card variant="panel" as="section">
	<Eyebrow>{$_('app.name')}</Eyebrow>
	<h1 class="mt-1.5 text-2xl font-bold tracking-tighter">{$_('auth.signIn')}</h1>
	<p class="mt-1 text-sm text-ink-muted">{$_('auth.signInSubtitle')}</p>

	<form class="mt-6 flex flex-col gap-4" onsubmit={submit} novalidate>
		{#if summaryKey}
			<Alert tone="warning">{$_(summaryKey)}</Alert>
		{/if}

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

	{#if offerSetup}
		<p class="mt-5 text-sm text-ink-muted">
			{$_('auth.noAccount')}
			<a href="/register" class="font-semibold text-accent-on-soft hover:underline">
				{$_('auth.createOrganization')}
			</a>
		</p>
	{/if}
</Card>
