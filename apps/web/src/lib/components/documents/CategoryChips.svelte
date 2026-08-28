<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { DocumentCategorySummary } from '@beacon/shared';
	import { Button } from '$lib/components/ui';

	type Props = {
		categories: DocumentCategorySummary[];
		selectedId: string;
		onSelect: (id: string) => void;
	};

	let { categories, selectedId, onSelect }: Props = $props();
</script>

<div class="flex flex-wrap gap-2" aria-label={$_('documents.filterLabel')}>
	<Button size="sm" variant={selectedId === '' ? 'primary' : 'ghost'} onclick={() => onSelect('')}>
		{$_('documents.all')}
	</Button>
	{#each categories as category (category.id)}
		<Button
			size="sm"
			variant={selectedId === category.id ? 'primary' : 'ghost'}
			onclick={() => onSelect(category.id)}
		>
			{category.name}
		</Button>
	{/each}
</div>
