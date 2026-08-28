<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { Button, Card, Eyebrow } from '$lib/components/ui';
	import { theme, THEMES } from '$lib/theme.svelte';
</script>

<main class="mx-auto max-w-3xl p-10">
	<Eyebrow>{$_('nav.dashboard')}</Eyebrow>
	<h1 class="mt-1.5 text-3xl font-bold tracking-tighter">{$_('app.name')}</h1>

	<Card variant="panel" as="section" class="mt-6">
		<Eyebrow>{$_('theme.label')}</Eyebrow>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each THEMES as option (option)}
				<Button
					size="sm"
					variant={theme.current === option ? 'primary' : 'secondary'}
					aria-pressed={theme.current === option}
					onclick={() => theme.set(option)}
				>
					{$_(`theme.${option}`)}
				</Button>
			{/each}
		</div>
	</Card>
</main>
