<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { DocumentUploadPolicy } from '@beacon/shared';
	import { formatFileSize } from '@beacon/shared';

	type Props = {
		policy: DocumentUploadPolicy | null;
		onFile: (file: File) => void;
	};

	let { policy, onFile }: Props = $props();

	let dragging = $state(false);

	function pick(files: FileList | null) {
		const file = files?.[0];
		if (file) onFile(file);
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		pick(event.dataTransfer?.files ?? null);
	}
</script>

<div
	role="group"
	aria-label={$_('documents.dropzone.title')}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	class="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed p-8 text-center transition-colors
	       {dragging ? 'border-accent bg-accent-soft' : 'border-border-default bg-surface-muted'}"
>
	<p class="text-sm font-semibold">
		{dragging ? $_('documents.dropzone.drop') : $_('documents.dropzone.title')}
	</p>
	<p class="text-xs text-ink-muted">
		{$_('documents.dropzone.hint', {
			values: { size: formatFileSize(policy?.maxBytes ?? 0) }
		})}
	</p>
	{#if policy?.encryptedAtRest}
		<p class="text-2xs text-ink-muted">{$_('documents.dropzone.encrypted')}</p>
	{/if}

	<label class="mt-1">
		<span
			class="inline-flex cursor-pointer items-center rounded-full border border-border-default bg-surface px-5 py-2.5 text-sm font-semibold hover:bg-surface-muted"
		>
			{$_('documents.dropzone.browse')}
		</span>
		<input
			type="file"
			class="sr-only"
			accept={policy?.acceptedExtensions.join(',')}
			onchange={(event) => pick((event.currentTarget as HTMLInputElement).files)}
		/>
	</label>
</div>
