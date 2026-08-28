<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { DocumentSummary } from '@beacon/shared';
	import { formatFileSize } from '@beacon/shared';
	import { Badge, Button } from '$lib/components/ui';
	import { iconFor, formatUploadedAt } from '$lib/documents/labels';

	type Props = {
		documents: DocumentSummary[];
		locale: string;
		openingId: string | null;
		onOpen: (document: DocumentSummary) => void;
		onSelect: (document: DocumentSummary) => void;
	};

	let { documents, locale, openingId, onOpen, onSelect }: Props = $props();

	const kindTone: Record<ReturnType<typeof iconFor>, 'accent' | 'info' | 'success' | 'neutral'> = {
		pdf: 'accent',
		docx: 'info',
		image: 'success',
		other: 'neutral'
	};

	const kindLabel: Record<ReturnType<typeof iconFor>, string> = {
		pdf: 'PDF',
		docx: 'DOCX',
		image: 'IMG',
		other: '—'
	};
</script>

<div class="overflow-x-auto">
	<table class="w-full min-w-[42rem] border-collapse text-left">
		<caption class="sr-only">{$_('documents.title')}</caption>
		<thead>
			<tr
				class="border-b border-border-subtle text-eyebrow tracking-eyebrow text-ink-muted uppercase"
			>
				<th scope="col" class="py-2 font-semibold">{$_('documents.columnName')}</th>
				<th scope="col" class="py-2 font-semibold">{$_('documents.columnCategory')}</th>
				<th scope="col" class="py-2 font-semibold">{$_('documents.columnDate')}</th>
				<th scope="col" class="py-2 text-right font-semibold">{$_('documents.columnSize')}</th>
				<th scope="col" class="py-2 text-right font-semibold">
					<span class="sr-only">{$_('documents.open')}</span>
				</th>
			</tr>
		</thead>
		<tbody>
			{#each documents as document (document.id)}
				<tr class="border-b border-border-subtle last:border-0">
					<td class="py-3">
						<button
							type="button"
							class="flex min-w-0 items-center gap-3 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
							onclick={() => onSelect(document)}
						>
							<Badge tone={kindTone[iconFor(document.contentType)]} class="shrink-0">
								{kindLabel[iconFor(document.contentType)]}
							</Badge>
							<span class="min-w-0">
								<span class="block truncate text-sm font-semibold">{document.title}</span>
								<span class="block truncate text-xs text-ink-muted">
									{document.scope === 'organization'
										? $_('documents.organizationWide')
										: document.ownerName}
								</span>
							</span>
						</button>
					</td>
					<td class="py-3 text-sm text-ink-muted">{document.categoryName}</td>
					<td class="py-3 font-mono text-xs text-ink-muted">
						{formatUploadedAt(document.uploadedAt, locale)}
					</td>
					<td class="py-3 text-right font-mono text-xs text-ink-muted">
						{formatFileSize(document.size)}
					</td>
					<td class="py-3 text-right">
						<Button
							size="sm"
							variant="quiet"
							disabled={openingId === document.id}
							onclick={() => onOpen(document)}
						>
							{openingId === document.id ? $_('documents.opening') : $_('documents.open')}
						</Button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
