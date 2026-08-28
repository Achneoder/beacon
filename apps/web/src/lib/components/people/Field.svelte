<script lang="ts">
	type Props = {
		label: string;
		/** Null renders the "not set" placeholder rather than an empty cell. */
		value: string | null;
		placeholder: string;
		/** Identifiers, dates and durations are mono throughout Beacon. */
		mono?: boolean;
	};

	let { label, value, placeholder, mono = false }: Props = $props();
</script>

<div class="min-w-0">
	<dt class="text-eyebrow font-semibold tracking-eyebrow text-ink-muted uppercase">{label}</dt>
	<dd
		class="mt-1 truncate text-sm {value ? 'text-ink' : 'text-ink-muted italic'} {mono && value
			? 'font-mono'
			: ''}"
	>
		{value ?? placeholder}
	</dd>
</div>
