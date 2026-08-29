<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import type {
		DocumentAccessLevel,
		DocumentAccessSubject,
		DocumentCategorySummary,
		DocumentDetail,
		DocumentSummary,
		DocumentUploadPolicy
	} from '@beacon/shared';
	import { Alert, Button, Card, TextField } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
	import {
		AccessPanel,
		CategoryChips,
		DocumentTable,
		Dropzone,
		VersionList
	} from '$lib/components/documents';
	import {
		deleteDocument,
		downloadDocument,
		getDocument,
		getUploadPolicy,
		grantAccess,
		listCategories,
		listDocuments,
		revokeAccess,
		uploadDocument,
		uploadVersion
	} from '$lib/api/documents';
	import { documentErrorKey } from '$lib/documents/errors';
	import { session } from '$lib/auth/session.svelte';

	let categories = $state<DocumentCategorySummary[]>([]);
	let policy = $state<DocumentUploadPolicy | null>(null);
	let documents = $state<DocumentSummary[]>([]);
	let selectedCategoryId = $state('');
	let loading = $state(true);
	let loadErrorKey = $state<string | null>(null);
	let notice = $state<string | null>(null);

	const canWrite = $derived(session.can('document:write'));
	const lang = $derived($locale ?? 'en');

	$effect(() => {
		void init();
	});

	/**
	 * The search results deep-link with `?open=<id>`. The list has to have loaded
	 * before the target exists, so this watches the param against `documents` rather
	 * than racing `init` — and it re-runs if another search result lands while the
	 * page is already mounted. The param is consumed once the panel is up; leaving it
	 * would make a refresh re-open the document and make "close" not stick.
	 */
	$effect(() => {
		// `$page.url` is absent outside the Kit runtime — the component tests mount
		// the page directly, with no router behind it.
		const openId = $page.url?.searchParams.get('open');
		if (!openId || selected?.id === openId) return;

		const target = documents.find((document) => document.id === openId);
		if (!target) return;

		const url = new URL($page.url.href);
		url.searchParams.delete('open');
		replaceState(url, {});

		void selectDocument(target);
	});

	async function init() {
		loading = true;
		loadErrorKey = null;

		try {
			[categories, policy] = await Promise.all([listCategories(), getUploadPolicy()]);
			documents = await listDocuments();
		} catch (error) {
			loadErrorKey = documentErrorKey(error);
		} finally {
			loading = false;
		}
	}

	async function refetchDocuments() {
		loading = true;
		loadErrorKey = null;

		try {
			documents = await listDocuments({ categoryId: selectedCategoryId || undefined });
		} catch (error) {
			loadErrorKey = documentErrorKey(error);
		} finally {
			loading = false;
		}
	}

	function selectCategory(id: string) {
		selectedCategoryId = id;
		void refetchDocuments();
	}

	// ── Upload ───────────────────────────────────────────────────────────────────
	let pendingFile = $state<File | null>(null);
	let uploadTitle = $state('');
	let uploadCategoryId = $state('');
	let uploading = $state(false);
	let uploadErrorKey = $state<string | null>(null);

	function onFile(file: File) {
		pendingFile = file;
		uploadTitle = file.name.replace(/\.[^.]+$/, '');
		uploadCategoryId = selectedCategoryId || categories[0]?.id || '';
		uploadErrorKey = null;
	}

	function cancelUpload() {
		pendingFile = null;
		uploadErrorKey = null;
	}

	async function submitUpload(event: SubmitEvent) {
		event.preventDefault();

		// Falls back to the first category rather than trusting uploadCategoryId alone
		// — it is set once, when the file is chosen, and categories can still be
		// loading at that moment.
		const categoryId = uploadCategoryId || categories[0]?.id || '';

		if (!pendingFile || !uploadTitle.trim() || !categoryId) {
			uploadErrorKey = 'errors.checkFields';
			return;
		}

		uploading = true;
		uploadErrorKey = null;

		try {
			await uploadDocument(pendingFile, {
				title: uploadTitle.trim(),
				categoryId
			});
			notice = 'documents.upload.done';
			pendingFile = null;
			uploadTitle = '';
			await refetchDocuments();
		} catch (error) {
			uploadErrorKey = documentErrorKey(error);
		} finally {
			uploading = false;
		}
	}

	// ── Opening a document ──────────────────────────────────────────────────────
	let openingId = $state<string | null>(null);

	async function openDocument(document: DocumentSummary) {
		openingId = document.id;

		try {
			const { url } = await downloadDocument(document.id);
			window.open(url, '_blank', 'noopener');
		} catch (error) {
			loadErrorKey = documentErrorKey(error);
		} finally {
			openingId = null;
		}
	}

	// ── The inline detail panel ─────────────────────────────────────────────────
	let selected = $state<DocumentSummary | null>(null);
	let detail = $state<DocumentDetail | null>(null);
	let detailLoading = $state(false);
	let detailErrorKey = $state<string | null>(null);
	let newVersionUploading = $state(false);
	let accessBusy = $state(false);

	async function selectDocument(document: DocumentSummary) {
		if (selected?.id === document.id) {
			selected = null;
			detail = null;
			return;
		}

		selected = document;
		await loadDetail(document);
	}

	/** Shared by a row click and the retry after a failed load. */
	async function loadDetail(document: DocumentSummary) {
		detail = null;
		detailErrorKey = null;
		detailLoading = true;

		try {
			detail = await getDocument(document.id);
		} catch (error) {
			detailErrorKey = documentErrorKey(error);
		} finally {
			detailLoading = false;
		}
	}

	function retryDetail() {
		if (selected) void loadDetail(selected);
	}

	async function addVersion(file: File) {
		if (!detail) return;

		newVersionUploading = true;
		detailErrorKey = null;

		try {
			await uploadVersion(detail.id, file);
			detail = await getDocument(detail.id);
			await refetchDocuments();
		} catch (error) {
			detailErrorKey = documentErrorKey(error);
		} finally {
			newVersionUploading = false;
		}
	}

	async function removeDocument() {
		if (!detail) return;
		if (!confirm($_('documents.confirmDelete'))) return;

		try {
			await deleteDocument(detail.id);
			notice = 'documents.deleted';
			selected = null;
			detail = null;
			await refetchDocuments();
		} catch (error) {
			detailErrorKey = documentErrorKey(error);
		}
	}

	async function grantAccessTo(
		subject: DocumentAccessSubject,
		subjectId: string,
		level: DocumentAccessLevel
	) {
		if (!detail) return;

		accessBusy = true;
		detailErrorKey = null;

		try {
			await grantAccess(detail.id, { subject, subjectId, level });
			detail = await getDocument(detail.id);
			notice = 'documents.access.granted';
		} catch (error) {
			detailErrorKey = documentErrorKey(error);
		} finally {
			accessBusy = false;
		}
	}

	async function revokeAccessFrom(accessId: string) {
		if (!detail) return;

		accessBusy = true;
		detailErrorKey = null;

		try {
			await revokeAccess(detail.id, accessId);
			detail = await getDocument(detail.id);
			notice = 'documents.access.revoked';
		} catch (error) {
			detailErrorKey = documentErrorKey(error);
		} finally {
			accessBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('documents.title')} · {$_('app.name')}</title>
</svelte:head>

<PageHeader kicker={$_('documents.kicker')} title={$_('documents.title')} />

{#if notice}
	<Alert tone="success" live="status" class="mt-4">{$_(notice)}</Alert>
{/if}

<div class="mt-6">
	<CategoryChips {categories} selectedId={selectedCategoryId} onSelect={selectCategory} />
</div>

<Card variant="panel" as="section" class="mt-5">
	{#if loadErrorKey}
		<Alert tone="warning">{$_(loadErrorKey)}</Alert>
	{:else if loading}
		<p class="text-sm text-ink-muted">{$_('documents.loading')}</p>
	{:else if documents.length === 0}
		<p class="text-sm text-ink-muted">
			{selectedCategoryId ? $_('documents.emptyFiltered') : $_('documents.empty')}
		</p>
	{:else}
		<DocumentTable
			{documents}
			locale={lang}
			{openingId}
			onOpen={openDocument}
			onSelect={selectDocument}
		/>
	{/if}
</Card>

{#if selected && detail}
	<Card variant="panel" as="section" class="mt-5 flex flex-col gap-6">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				<h2 class="truncate text-base font-bold">{detail.title}</h2>
				<p class="text-xs text-ink-muted">{detail.categoryName}</p>
			</div>
			{#if detail.canManage}
				<Button size="sm" variant="quiet" onclick={removeDocument}>{$_('documents.delete')}</Button>
			{/if}
		</div>

		{#if detailErrorKey}
			<Alert tone="warning">{$_(detailErrorKey)}</Alert>
		{/if}

		<VersionList versions={detail.versions} currentVersionId={detail.versionId} locale={lang} />

		{#if detail.canWrite}
			<div>
				<h3 class="text-sm font-bold">{$_('documents.versions.newVersion')}</h3>
				<div class="mt-3">
					<Dropzone {policy} onFile={addVersion} />
				</div>
				{#if newVersionUploading}
					<p class="mt-2 text-xs text-ink-muted">{$_('documents.upload.uploading')}</p>
				{/if}
			</div>
		{/if}

		{#if detail.canManage}
			<AccessPanel
				access={detail.access}
				busy={accessBusy}
				onGrant={grantAccessTo}
				onRevoke={revokeAccessFrom}
			/>
		{/if}
	</Card>
{:else if selected && detailLoading}
	<Card variant="panel" as="section" class="mt-5">
		<p class="text-sm text-ink-muted">{$_('documents.loading')}</p>
	</Card>
{:else if selected}
	<!-- The load failed: `detail` is null, so show the failure rather than a blank
	     panel — and keep the panel open, with a retry, so the selection is not
	     silently swallowed by the next click toggling it closed. -->
	<Card variant="panel" as="section" class="mt-5">
		<Alert tone="warning">{$_(detailErrorKey ?? 'errors.unexpected')}</Alert>
		<Button size="sm" class="mt-3" onclick={retryDetail}>{$_('documents.detailRetry')}</Button>
	</Card>
{/if}

{#if canWrite && categories.length > 0}
	<Card variant="panel" as="section" class="mt-5">
		{#if pendingFile}
			<h2 class="text-sm font-bold">{$_('documents.upload.title')}</h2>

			{#if uploadErrorKey}
				<Alert tone="warning" class="mt-3">{$_(uploadErrorKey)}</Alert>
			{/if}

			<form class="mt-4 flex flex-col gap-4" onsubmit={submitUpload} novalidate>
				<TextField
					id="upload-title"
					label={$_('documents.upload.name')}
					bind:value={uploadTitle}
					required
				/>
				<div class="flex flex-col gap-1.5">
					<label for="upload-category" class="text-sm font-semibold">
						{$_('documents.upload.category')}
					</label>
					<select
						id="upload-category"
						bind:value={uploadCategoryId}
						class="rounded-control border border-border-default bg-surface px-3.5 py-2.5 text-sm"
					>
						{#each categories as category (category.id)}
							<option value={category.id}>{category.name}</option>
						{/each}
					</select>
				</div>
				<div class="flex gap-3">
					<Button type="submit" variant="primary" size="sm" disabled={uploading}>
						{uploading ? $_('documents.upload.uploading') : $_('documents.upload.submit')}
					</Button>
					<Button size="sm" variant="quiet" onclick={cancelUpload}>
						{$_('documents.upload.cancel')}
					</Button>
				</div>
			</form>
		{:else}
			<Dropzone {policy} {onFile} />
		{/if}
	</Card>
{/if}
