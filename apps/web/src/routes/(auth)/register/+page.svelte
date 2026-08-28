<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api/client';
	import { Alert, Button, Card, Eyebrow, TextField } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';
	import { setupRequired } from '$lib/auth/setup';
	import { previewSlug } from '$lib/auth/slug';
	import { validateRegistration, type RegistrationFields } from '$lib/auth/validation';

	let organizationName = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let serverErrorKey = $state<string | null>(null);
	let submitting = $state(false);
	/**
	 * Field errors stay hidden until the first submit, so a half-typed address is not
	 * called wrong. After that they update live, so fixing a field clears its message.
	 */
	let showErrors = $state(false);
	/**
	 * Beacon holds one organization, so this screen is a first-run installer: once the
	 * owner exists there is nothing here to fill in. It starts open and closes on the
	 * answer, rather than the other way round, so an unclaimed instance never flashes a
	 * dead end at whoever is setting it up.
	 */
	let closed = $state(false);

	onMount(async () => {
		closed = !(await setupRequired());
	});

	/** Input ids in DOM order, so an invalid submit can focus the first problem. */
	const FIELD_IDS: Record<keyof RegistrationFields, string> = {
		organizationName: 'register-organization',
		firstName: 'register-first-name',
		lastName: 'register-last-name',
		email: 'register-email',
		password: 'register-password',
		passwordConfirm: 'register-password-confirm'
	};

	const slug = $derived(previewSlug(organizationName));

	const errors = $derived(
		validateRegistration({
			organizationName,
			firstName,
			lastName,
			email,
			password,
			passwordConfirm
		})
	);

	const summaryKey = $derived(
		serverErrorKey ?? (showErrors && Object.keys(errors).length > 0 ? 'errors.checkFields' : null)
	);

	function errorFor(field: keyof RegistrationFields): string | undefined {
		const key = errors[field];

		return showErrors && key ? $_(key) : undefined;
	}

	function focusFirstInvalid() {
		const field = (Object.keys(FIELD_IDS) as (keyof RegistrationFields)[]).find(
			(name) => errors[name]
		);
		if (field) document.getElementById(FIELD_IDS[field])?.focus();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		showErrors = true;
		serverErrorKey = null;

		// Never fail silently: point at the first problem and let the alert say so.
		if (Object.keys(errors).length > 0) {
			focusFirstInvalid();
			return;
		}

		submitting = true;
		try {
			await session.register({
				organizationName: organizationName.trim(),
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				email: email.trim(),
				password
			});
			await goto('/');
		} catch (error) {
			// The only conflict registration can hit: somebody installed this instance
			// first — possibly in the seconds since the screen loaded.
			if (error instanceof ApiError && error.status === 409) {
				closed = true;
			} else {
				serverErrorKey = errorKey(error);
			}
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
	<h1 class="mt-1.5 text-2xl font-bold tracking-tighter">
		{closed ? $_('register.closedTitle') : $_('register.title')}
	</h1>
	<p class="mt-1 text-sm text-ink-muted">
		{closed ? $_('register.closedSubtitle') : $_('register.subtitle')}
	</p>

	{#if closed}
		<p class="mt-6 text-sm text-ink-muted">{$_('register.closedBody')}</p>
	{:else}
		<form class="mt-6 flex flex-col gap-4" onsubmit={submit} novalidate>
			{#if summaryKey}
				<Alert tone="warning">{$_(summaryKey)}</Alert>
			{/if}

			<TextField
				id={FIELD_IDS.organizationName}
				label={$_('register.organizationName')}
				autocomplete="organization"
				hint={slug ? $_('register.slugHint', { values: { slug } }) : undefined}
				error={errorFor('organizationName')}
				required
				bind:value={organizationName}
			/>

			<div class="grid gap-4 sm:grid-cols-2">
				<TextField
					id={FIELD_IDS.firstName}
					label={$_('register.firstName')}
					autocomplete="given-name"
					error={errorFor('firstName')}
					required
					bind:value={firstName}
				/>
				<TextField
					id={FIELD_IDS.lastName}
					label={$_('register.lastName')}
					autocomplete="family-name"
					error={errorFor('lastName')}
					required
					bind:value={lastName}
				/>
			</div>

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
				autocomplete="new-password"
				hint={$_('register.passwordHint')}
				error={errorFor('password')}
				required
				bind:value={password}
			/>
			<TextField
				id={FIELD_IDS.passwordConfirm}
				label={$_('auth.passwordConfirm')}
				type="password"
				autocomplete="new-password"
				error={errorFor('passwordConfirm')}
				required
				bind:value={passwordConfirm}
			/>

			<Button type="submit" variant="primary" disabled={submitting}>
				{submitting ? $_('register.submitting') : $_('register.submit')}
			</Button>
		</form>
	{/if}

	<p class="mt-5 text-sm text-ink-muted">
		{$_('auth.haveAccount')}
		<a href="/login" class="font-semibold text-accent-on-soft hover:underline">
			{$_('auth.signIn')}
		</a>
	</p>
</Card>
