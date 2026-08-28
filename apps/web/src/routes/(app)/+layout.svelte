<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Avatar, Button } from '$lib/components/ui';
	import { session } from '$lib/auth/session.svelte';

	let { children } = $props();

	// A convenience only — the API rejects an unauthenticated request regardless.
	$effect(() => {
		if (session.status === 'anonymous') goto('/login');
	});

	const user = $derived(session.user);
	const initials = $derived(
		user ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase() : ''
	);

	const links = [
		{ href: '/', key: 'nav.dashboard' },
		{ href: '/attendance', key: 'nav.attendance' },
		{ href: '/holidays', key: 'nav.holidays' },
		{ href: '/documents', key: 'nav.documents' }
	];

	async function signOut() {
		await session.logout();
		await goto('/login');
	}
</script>

{#if user}
	<div class="min-h-screen">
		<header class="border-b border-border-subtle bg-surface">
			<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-3">
				<span class="font-bold tracking-tighter">{user.organizationName}</span>

				<nav aria-label={$_('nav.dashboard')} class="flex flex-wrap gap-1">
					{#each links as link (link.href)}
						<a
							href={link.href}
							aria-current={page.url.pathname === link.href ? 'page' : undefined}
							class="rounded-control px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-muted aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-on-soft"
						>
							{$_(link.key)}
						</a>
					{/each}
				</nav>

				<div class="ml-auto flex items-center gap-3">
					<Avatar {initials} name={`${user.firstName} ${user.lastName}`} />
					<Button size="sm" variant="ghost" onclick={signOut}>{$_('auth.signOut')}</Button>
				</div>
			</div>
		</header>

		{@render children()}
	</div>
{:else}
	<p class="p-10 text-sm text-ink-muted">{$_('auth.restoring')}</p>
{/if}
