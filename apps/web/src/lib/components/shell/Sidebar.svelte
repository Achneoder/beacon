<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { ClockState, Permission, SessionUser } from '@beacon/shared';
	import { session } from '$lib/auth/session.svelte';
	import NavItem from './NavItem.svelte';
	import SearchField from './SearchField.svelte';
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
		// Booking time is a `time:read` screen, same reasoning as the timesheet above —
		// a plain employee holds it and needs the catalog to book against.
		{ href: '/time', key: 'nav.timeTracking', permission: 'time:read' },
		{ href: '/documents', key: 'nav.documents', permission: 'document:read' },
		// Read, not write: the default `manager` role approves time without ever
		// booking any, and gating the screen on `attendance:write` hid it from exactly
		// the people it exists for. The page itself decides whether it shows a queue
		// or the requests you raised.
		{ href: '/approvals', key: 'nav.approvals', permission: 'attendance:read' },
		// The one entry gated on `report:read`, which the default `employee` role does
		// not hold — so the reports screen simply is not there for most people, and
		// the exception to the correction above rather than another instance of it.
		{ href: '/reports', key: 'nav.reports', permission: 'report:read' },
		{ href: '/people', key: 'nav.people', permission: 'employee:read' },
		// The catalog's admin screen — distinct from `/time`, which only needs to read it.
		{ href: '/projects', key: 'nav.projects', permission: 'project:manage' },
		{ href: '/settings/organization', key: 'nav.settings', permission: 'organization:manage' },
		// Everyone has a profile — no permission gates your own account.
		{ href: '/profile', key: 'nav.profile' }
	];

	const items = $derived(NAV.filter((item) => !item.permission || session.can(item.permission)));

	/**
	 * Search spans documents and people, so it is offered to anyone who can read
	 * either. An account with neither would get a box that can only ever come back
	 * empty — the same reasoning that filters the nav above.
	 */
	const canSearch = $derived(session.can('document:read') || session.can('employee:read'));
</script>

<div
	class="flex shrink-0 flex-col gap-6 border-border-subtle bg-surface p-4
	       max-lg:border-b lg:sticky lg:top-0 lg:h-screen lg:w-[258px] lg:border-r"
>
	<!-- Brand and search read as one block; the canvas's gap belongs below them. -->
	<div class="flex flex-col gap-3">
		<a href="/" class="flex items-center gap-2 rounded-control px-3 py-2">
			<span class="size-2 rounded-full bg-accent" aria-hidden="true"></span>
			<span class="truncate text-base font-bold tracking-tighter">{user.organizationName}</span>
		</a>

		{#if canSearch}
			<SearchField />
		{/if}
	</div>

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
