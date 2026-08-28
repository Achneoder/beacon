<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { Alert, Button, Card, Eyebrow, TextField } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import { previewSlug } from '$lib/auth/slug';

	const MIN_PASSWORD_LENGTH = 12;

	let organizationName = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let errorMessageKey = $state<string | null>(null);
	let submitting = $state(false);
	/** Field errors stay hidden until the first submit, so typing is not nagged at. */
	let submitted = $state(false);

	const slug = $derived(previewSlug(organizationName));

	const fieldErrors = $derived({
		password:
			password.length > 0 && password.length < MIN_PASSWORD_LENGTH
				? 'errors.passwordTooShort'
				: null,
		passwordConfirm:
			passwordConfirm.length > 0 && passwordConfirm !== password ? 'errors.passwordMismatch' : null
	});

	const valid = $derived(
		organizationName.trim().length > 1 &&
			firstName.trim().length > 0 &&
			lastName.trim().length > 0 &&
			email.includes('@') &&
			password.length >= MIN_PASSWORD_LENGTH &&
			password === passwordConfirm
	);

	function errorFor(key: string | null): string | undefined {
		return submitted && key ? $_(key) : undefined;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitted = true;
		errorMessageKey = null;
		if (!valid) return;

		submitting = true;
		try {
			await session.register({ organizationName, firstName, lastName, email, password });
			await goto('/');
		} catch (error) {
			errorMessageKey = errorKey(error);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('register.title')} · {$_('app.name')}</title>
</svelte:head>

<Card variant="panel" as="section">
	<Eyebrow>{$_('app.name')}</Eyebrow>
	<h1 class="mt-1.5 text-2xl font-bold tracking-tighter">{$_('register.title')}</h1>
	<p class="mt-1 text-sm text-ink-muted">{$_('register.subtitle')}</p>

	<form class="mt-6 flex flex-col gap-4" onsubmit={submit} novalidate>
		{#if errorMessageKey}
			<Alert tone="warning">{$_(errorMessageKey)}</Alert>
		{/if}

		<TextField
			id="register-organization"
			label={$_('register.organizationName')}
			autocomplete="organization"
			hint={slug ? $_('register.slugHint', { values: { slug } }) : undefined}
			required
			bind:value={organizationName}
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<TextField
				id="register-first-name"
				label={$_('register.firstName')}
				autocomplete="given-name"
				required
				bind:value={firstName}
			/>
			<TextField
				id="register-last-name"
				label={$_('register.lastName')}
				autocomplete="family-name"
				required
				bind:value={lastName}
			/>
		</div>

		<TextField
			id="register-email"
			label={$_('auth.email')}
			type="email"
			autocomplete="email"
			required
			bind:value={email}
		/>
		<TextField
			id="register-password"
			label={$_('auth.password')}
			type="password"
			autocomplete="new-password"
			hint={$_('register.passwordHint')}
			error={errorFor(fieldErrors.password)}
			required
			bind:value={password}
		/>
		<TextField
			id="register-password-confirm"
			label={$_('auth.passwordConfirm')}
			type="password"
			autocomplete="new-password"
			error={errorFor(fieldErrors.passwordConfirm)}
			required
			bind:value={passwordConfirm}
		/>

		<Button type="submit" variant="primary" disabled={submitting}>
			{submitting ? $_('register.submitting') : $_('register.submit')}
		</Button>
	</form>

	<p class="mt-5 text-sm text-ink-muted">
		{$_('auth.haveAccount')}
		<a href="/login" class="font-semibold text-accent-on-soft hover:underline">
			{$_('auth.signIn')}
		</a>
	</p>
</Card>
