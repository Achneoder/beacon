<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet';
	type Size = 'sm' | 'md' | 'lg';

	type Props = {
		children: Snippet;
		variant?: Variant;
		/** Fill colour of the `primary` variant; ignored by the other variants. */
		tone?: 'accent' | 'success';
		size?: Size;
		/** Renders an `<a>` instead of a `<button>`. */
		href?: string;
		class?: string;
	} & Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'href' | 'class'>;

	// svelte-ignore custom_element_props_identifier
	let {
		children,
		variant = 'secondary',
		tone = 'accent',
		size = 'md',
		href,
		class: extra = '',
		...rest
	}: Props = $props();

	const base =
		'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap ' +
		'transition-[filter,background-color,transform] duration-150 ' +
		'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

	const sizes: Record<Size, string> = {
		sm: 'px-4 py-2 text-xs',
		md: 'px-5 py-3 text-sm',
		lg: 'px-7 py-3.5 text-base'
	};

	const fills: Record<'accent' | 'success', string> = {
		accent: 'bg-accent',
		success: 'bg-success'
	};

	const variants: Record<Variant, string> = $derived({
		primary: `text-white shadow-card hover:brightness-110 active:translate-y-px ${fills[tone]}`,
		secondary:
			'border border-border-default bg-surface-muted text-ink hover:bg-border-subtle active:translate-y-px',
		ghost: 'border border-border-default bg-surface text-ink hover:bg-surface-muted',
		quiet: 'text-accent-on-soft hover:underline'
	});

	const classes = $derived(`${base} ${sizes[size]} ${variants[variant]} ${extra}`);
</script>

{#if href}
	<a {href} class={classes} {...rest}>{@render children()}</a>
{:else}
	<button type="button" class={classes} {...rest}>{@render children()}</button>
{/if}
