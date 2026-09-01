<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	type Props = {
		/** Accessible name for the field — always visible, never a placeholder. */
		label: string;
		value: string;
		/** Supplied by the caller so labels, errors and hints can be wired together. */
		id: string;
		/** The `<option>`s, so a caller can group them or label them as it needs. */
		children: Snippet;
		/** Shown below the field and announced when the value is rejected. */
		error?: string;
		hint?: string;
		class?: string;
	} & Omit<HTMLSelectAttributes, 'id' | 'value' | 'class'>;

	// svelte-ignore custom_element_props_identifier
	let {
		label,
		value = $bindable(),
		id,
		children,
		error,
		hint,
		class: extra = '',
		...rest
	}: Props = $props();

	const errorId = $derived(`${id}-error`);
	const hintId = $derived(`${id}-hint`);

	// Only reference ids that are actually rendered — a dangling aria-describedby is
	// worse than none, since a screen reader announces nothing for it.
	const describedBy = $derived(
		[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
	);

	const field = $derived(
		'w-full rounded-control border bg-surface px-3.5 py-2.5 text-sm text-ink ' +
			'transition-colors disabled:opacity-50 ' +
			(error ? 'border-warning' : 'border-border-default hover:border-ink-muted')
	);
</script>

<div class="flex flex-col gap-1.5 {extra}">
	<label for={id} class="text-sm font-semibold text-ink">{label}</label>
	<select
		{id}
		bind:value
		class={field}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		{...rest}
	>
		{@render children()}
	</select>
	{#if hint}
		<p id={hintId} class="text-xs text-ink-muted">{hint}</p>
	{/if}
	{#if error}
		<p id={errorId} class="text-xs font-medium text-warning">{error}</p>
	{/if}
</div>
