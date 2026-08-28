<script lang="ts">
	import { page } from '$app/state';

	type Props = {
		href: string;
		/** Already-localised label. */
		label: string;
	};

	let { href, label }: Props = $props();

	// `/` would otherwise prefix-match every route, so the root is matched exactly and
	// everything else also matches its sub-routes (`/people/3` keeps *People* active).
	const active = $derived(
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href)
	);
</script>

<a
	{href}
	aria-current={active ? 'page' : undefined}
	class="group flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-semibold text-ink-muted
	       transition-colors duration-150 hover:bg-surface-muted hover:text-ink
	       aria-[current=page]:bg-accent-soft aria-[current=page]:font-bold aria-[current=page]:text-accent-on-soft"
>
	<!-- The dot marks the active item visually; `aria-current` carries it for assistive tech. -->
	<span
		aria-hidden="true"
		class="size-1.5 shrink-0 rounded-full bg-transparent transition-colors duration-150
		       group-aria-[current=page]:bg-accent"
	></span>
	{label}
</a>
