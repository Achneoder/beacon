<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { fullName, initialsOf, type SessionUser } from '@beacon/shared';
	import { Avatar, Button } from '$lib/components/ui';

	type Props = {
		user: SessionUser;
		onSignOut: () => void;
	};

	let { user, onSignOut }: Props = $props();

	const name = $derived(fullName(user));
	const initials = $derived(initialsOf(user));

	// The design shows a job title here. It is optional, so the primary role stands in
	// where an organization has not filled one in. Neither is an authorization signal —
	// `session.can()` decides what the UI offers.
	const subtitle = $derived(
		user.jobTitle ?? (user.roleKeys[0] ? $_(`roles.${user.roleKeys[0]}`) : user.email)
	);
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
