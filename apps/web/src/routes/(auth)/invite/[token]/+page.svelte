<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Alert, Button, Card, Eyebrow, TextField } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import { MIN_PASSWORD_LENGTH } from '$lib/auth/validation';

	let password = $state('');
	let passwordConfirm = $state('');
	let submitting = $state(false);
	let showErrors = $state(false);
	let serverErrorKey = $state<string | null>(null);

	// The token is the credential and it is in the URL — nothing else identifies the
	// invitee, and the server tells us nothing about it until acceptance is attempted.
	const token = $derived(page.params.token ?? '');

	const passwordError = $derived(
		!password
			? 'errors.required'
			: password.length < MIN_PASSWORD_LENGTH
				? 'errors.passwordTooShort'
				: null
	);
	const confirmError = $derived(
		!passwordConfirm
			? 'errors.required'
			: !passwordError && passwordConfirm !== password
				? 'errors.passwordMismatch'
				: null
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		showErrors = true;
		serverErrorKey = null;

		if (passwordError || confirmError) {
			document
				.getElementById(passwordError ? 'invite-password' : 'invite-password-confirm')
				?.focus();
			return;
		}

		submitting = true;
		try {
			await session.acceptInvitation({ token, password });
			await goto('/');
		} catch (error) {
			// A wrong, spent or expired token is one failure with one message — the API
			// deliberately does not distinguish them.
			const key = errorKey(error);
			serverErrorKey = key === 'errors.unexpected' ? 'errors.inviteInvalid' : key;
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('app.name')}</title>
</svelte:head>

<Card variant="panel" as="section">
	<Eyebrow>{$_('app.name')}</Eyebrow>
	<h1 class="mt-1.5 text-2xl font-bold tracking-tighter">{$_('invite.title')}</h1>
	<p class="mt-1 text-sm text-ink-muted">{$_('invite.subtitle')}</p>

	<form class="mt-6 flex flex-col gap-4" onsubmit={submit} novalidate>
		{#if serverErrorKey}
			<Alert tone="warning">{$_(serverErrorKey)}</Alert>
		{/if}

		<TextField
			id="invite-password"
			label={$_('auth.password')}
			type="password"
			autocomplete="new-password"
			hint={$_('register.passwordHint')}
			error={showErrors && passwordError ? $_(passwordError) : undefined}
			required
			bind:value={password}
		/>
		<TextField
			id="invite-password-confirm"
			label={$_('auth.passwordConfirm')}
			type="password"
			autocomplete="new-password"
			error={showErrors && confirmError ? $_(confirmError) : undefined}
			required
			bind:value={passwordConfirm}
		/>

		<Button type="submit" variant="primary" disabled={submitting}>
			{submitting ? $_('invite.submitting') : $_('invite.submit')}
		</Button>
	</form>
</Card>
