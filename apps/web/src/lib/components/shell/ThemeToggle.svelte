<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { theme, THEMES } from '$lib/theme.svelte';
</script>

<!--
	A radio group rather than three buttons: the three options are one setting with one
	answer, so arrow keys move between them and only the chosen one is a tab stop.
-->
<fieldset>
	<legend class="text-eyebrow font-semibold tracking-eyebrow text-ink-muted uppercase">
		{$_('theme.label')}
	</legend>
	<div class="mt-2 flex gap-1 rounded-control bg-surface-muted p-1">
		{#each THEMES as option (option)}
			<label
				class="flex-1 cursor-pointer rounded-control px-2 py-1.5 text-center text-2xs font-semibold
				       text-ink-muted transition-colors duration-150 hover:text-ink
				       has-checked:bg-surface has-checked:font-bold has-checked:text-ink has-checked:shadow-card
				       has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-offset-2
				       has-focus-visible:outline-accent"
			>
				<input
					type="radio"
					name="appearance"
					value={option}
					class="sr-only"
					checked={theme.current === option}
					onchange={() => theme.set(option)}
				/>
				{$_(`theme.${option}`)}
			</label>
		{/each}
	</div>
</fieldset>
