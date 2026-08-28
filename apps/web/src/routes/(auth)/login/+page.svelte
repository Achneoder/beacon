<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { Alert, Button, Card, Eyebrow, TextField } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';
	import { errorKey } from '$lib/auth/errors';

	let email = $state('');
	let password = $state('');
	let errorMessageKey = $state<string | null>(null);
	let submitting = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errorMessageKey = null;
		submitting = true;

		try {
			await session.login({ email, password });
			await goto('/');
		} catch (error) {
			errorMessageKey = errorKey(error);
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
		{#if errorMessageKey}
			<Alert tone="warning">{$_(errorMessageKey)}</Alert>
		{/if}

		<TextField
			id="login-email"
			label={$_('auth.email')}
			type="email"
			autocomplete="email"
			required
			bind:value={email}
		/>
		<TextField
			id="login-password"
			label={$_('auth.password')}
			type="password"
			autocomplete="current-password"
			required
			bind:value={password}
		/>

		<Button type="submit" variant="primary" disabled={submitting}>
			{submitting ? $_('auth.submitting') : $_('auth.signIn')}
		</Button>
	</form>

	<p class="mt-5 text-sm text-ink-muted">
		{$_('auth.noAccount')}
		<a href="/register" class="font-semibold text-accent-on-soft hover:underline">
			{$_('auth.createOrganization')}
		</a>
	</p>
</Card>
