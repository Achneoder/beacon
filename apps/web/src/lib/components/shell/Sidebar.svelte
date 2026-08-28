<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { ClockState, Permission, SessionUser } from '@beacon/shared';
	import { session } from '$lib/auth/session.svelte';
	import NavItem from './NavItem.svelte';
	import StatusCard from './StatusCard.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import UserCard from './UserCard.svelte';

	type Props = {
		user: SessionUser;
		clockState: ClockState;
		clockSince?: string | Date | null;
		onSignOut: () => void;
	};

	let { user, clockState, clockSince = null, onSignOut }: Props = $props();

	/**
	 * The nav grows one entry per phase. Each declares the permission that makes its
	 * screen useful, so the sidebar is short for a limited account and never offers a
	 * link the API would refuse — a convenience, not enforcement.
	 */
	const NAV: { href: string; key: string; permission?: Permission }[] = [
		{ href: '/', key: 'nav.today', permission: 'attendance:read' },
		{ href: '/timesheet', key: 'nav.timesheet', permission: 'attendance:read' },
		{ href: '/calendar', key: 'nav.calendar', permission: 'attendance:read' },
		// Read, not write: the default `manager` role approves time without ever
		// booking any, and gating the screen on `attendance:write` hid it from exactly
		// the people it exists for. The page itself decides whether it shows a queue
		// or the requests you raised.
		{ href: '/approvals', key: 'nav.approvals', permission: 'attendance:read' },
		{ href: '/people', key: 'nav.people', permission: 'employee:read' },
		{ href: '/settings/organization', key: 'nav.settings', permission: 'organization:manage' },
		// Everyone has a profile — no permission gates your own account.
		{ href: '/profile', key: 'nav.profile' }
	];

	const items = $derived(NAV.filter((item) => !item.permission || session.can(item.permission)));
</script>

<div
	class="flex shrink-0 flex-col gap-6 border-border-subtle bg-surface p-4
	       max-lg:border-b lg:sticky lg:top-0 lg:h-screen lg:w-[258px] lg:border-r"
>
	<a href="/" class="flex items-center gap-2 rounded-control px-3 py-2">
		<span class="size-2 rounded-full bg-accent" aria-hidden="true"></span>
		<span class="truncate text-base font-bold tracking-tighter">{user.organizationName}</span>
	</a>

	<nav aria-label={$_('shell.navLabel')} class="min-w-0 flex-1">
		<ul class="flex gap-1 max-lg:overflow-x-auto lg:flex-col">
			{#each items as item (item.href)}
				<li><NavItem href={item.href} label={$_(item.key)} /></li>
			{/each}
		</ul>
	</nav>

	<!-- Pinned to the bottom of the sidebar: live status, appearance, then the user. -->
	<div class="flex flex-col gap-4">
		<StatusCard state={clockState} since={clockSince} />
		<ThemeToggle />
		<UserCard {user} {onSignOut} />
	</div>
</div>
