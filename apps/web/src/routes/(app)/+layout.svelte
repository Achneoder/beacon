<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { Sidebar } from '$lib/components/shell';
	import { session } from '$lib/auth/session.svelte';
	import { clock } from '$lib/attendance/clock.svelte';

	let { children } = $props();

	// A convenience only — the API rejects an unauthenticated request regardless.
	$effect(() => {
		if (session.status === 'anonymous') goto('/login');
	});

	const user = $derived(session.user);

	// One clock for the whole shell, so the sidebar and the Today screen cannot
	// describe different states.
	$effect(() => {
		if (user) void clock.refresh();
	});

	/**
	 * Re-read on focus. The counter itself is driven from the server's `since`, but a
	 * tab left open overnight — or a clock-out from another device — would otherwise
	 * still be showing yesterday's state.
	 */
	$effect(() => {
		const onFocus = () => void clock.refresh();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	});

	async function signOut() {
		clock.reset();
		await session.logout();
		await goto('/login');
	}
</script>

{#if user}
	<a
		href="#main"
		class="sr-only rounded-control bg-surface px-4 py-2 text-sm font-semibold shadow-overlay focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10"
	>
		{$_('shell.skipToContent')}
	</a>

	<div class="flex min-h-screen flex-col lg:flex-row">
		<Sidebar {user} clockState={clock.state} clockSince={clock.since} onSignOut={signOut} />

		<main id="main" class="min-w-0 flex-1 px-6 py-8 lg:px-10 lg:py-9">
			<div class="mx-auto max-w-[1180px]">{@render children()}</div>
		</main>
	</div>
{:else}
	<p class="p-10 text-sm text-ink-muted">{$_('auth.restoring')}</p>
{/if}
