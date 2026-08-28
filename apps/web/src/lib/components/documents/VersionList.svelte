<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { DocumentVersionSummary } from '@beacon/shared';
	import { formatFileSize } from '@beacon/shared';
	import { formatUploadedAt } from '$lib/documents/labels';

	type Props = {
		versions: DocumentVersionSummary[];
		currentVersionId: string;
		locale: string;
	};

	let { versions, currentVersionId, locale }: Props = $props();
</script>

<div>
	<h3 class="text-sm font-bold">{$_('documents.versions.title')}</h3>
	{#if versions.length === 0}
		<p class="mt-2 text-xs text-ink-muted">{$_('documents.versions.empty')}</p>
	{:else}
		<ul class="mt-3 flex flex-col gap-2">
			{#each versions as version (version.id)}
				<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
					<span class="flex items-center gap-2">
						<span class="font-mono text-xs text-ink-muted">
							{$_('documents.versions.number', { values: { number: version.versionNumber } })}
						</span>
						<span>{formatUploadedAt(version.uploadedAt, locale)}</span>
						{#if version.uploadedByName}
							<span class="text-xs text-ink-muted">{version.uploadedByName}</span>
						{/if}
						{#if version.id === currentVersionId}
							<span class="text-xs font-semibold text-accent-on-soft">
								{$_('documents.versions.current')}
							</span>
						{/if}
					</span>
					<span class="font-mono text-xs text-ink-muted">{formatFileSize(version.size)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
