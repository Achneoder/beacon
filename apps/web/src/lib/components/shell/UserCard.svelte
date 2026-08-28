<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { SessionUser } from '@beacon/shared';
	import { Avatar, Button } from '$lib/components/ui';

	type Props = {
		user: SessionUser;
		onSignOut: () => void;
	};

	let { user, onSignOut }: Props = $props();

	const name = $derived(`${user.firstName} ${user.lastName}`);
	const initials = $derived(`${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase());

	// The design shows a job title here. `User.jobTitle` arrives in phase 1; until then
	// the primary role is the closest true thing we can say about the person. It is not
	// an authorization signal — `session.can()` decides what the UI offers.
	const subtitle = $derived(user.roleKeys[0] ? $_(`roles.${user.roleKeys[0]}`) : user.email);
</script>

<div class="flex items-center gap-2.5">
	<Avatar {initials} {name} />
	<span class="min-w-0 flex-1">
		<span class="block truncate text-2xs font-bold text-ink">{name}</span>
		<span class="block truncate text-eyebrow text-ink-muted">{subtitle}</span>
	</span>
	<Button size="sm" variant="quiet" class="px-2 py-1" onclick={onSignOut}>
		{$_('auth.signOut')}
	</Button>
</div>
