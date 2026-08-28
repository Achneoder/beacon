<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Variant = 'panel' | 'card' | 'tile' | 'accent';

	type Props = {
		children: Snippet;
		/** Panels carry the page's primary content; tiles are the small stat boxes. */
		variant?: Variant;
		/** Set to render a `<section>` — otherwise a plain `<div>`. */
		as?: 'div' | 'section';
		class?: string;
	} & Omit<HTMLAttributes<HTMLElement>, 'class'>;

	// svelte-ignore custom_element_props_identifier
	let { children, variant = 'card', as = 'div', class: extra = '', ...rest }: Props = $props();

	const variants: Record<Variant, string> = {
		panel: 'rounded-panel border border-border-default bg-surface p-6 shadow-card',
		card: 'rounded-card border border-border-default bg-surface p-5',
		tile: 'rounded-card border border-border-default bg-surface px-5 py-4',
		accent: 'rounded-card border border-transparent bg-accent-soft px-5 py-4'
	};

	const classes = $derived(`min-w-0 ${variants[variant]} ${extra}`);
</script>

{#if as === 'section'}
	<section class={classes} {...rest}>{@render children()}</section>
{:else}
	<div class={classes} {...rest}>{@render children()}</div>
{/if}
