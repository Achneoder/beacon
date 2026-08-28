<script lang="ts">
	import { Avatar } from '$lib/components/ui';

	type Props = {
		/** Already-joined full name — `fullName()` from `@beacon/shared` builds it. */
		name: string;
		/** The job title, or whatever stands in for it. Omitted when there is none. */
		subtitle?: string | null;
		size?: 'sm' | 'md' | 'lg';
	};

	let { name, subtitle = null, size = 'md' }: Props = $props();

	// Initials from the displayed name, so a name that arrived pre-joined (an approver,
	// say) needs no separate first/last pair.
	const initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('') || '?'
	);
</script>

<div class="flex min-w-0 items-center gap-3">
	<Avatar {initials} {name} {size} />
	<span class="min-w-0">
		<span
			class="block truncate {size === 'lg'
				? 'text-xl font-bold tracking-tighter'
				: 'text-sm font-semibold'}"
		>
			{name}
		</span>
		{#if subtitle}
			<span class="block truncate text-xs text-ink-muted">{subtitle}</span>
		{/if}
	</span>
</div>
