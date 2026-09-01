import {
	ACCEPTED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	type CreateDocumentRequest,
	type DocumentAccessSummary,
	type DocumentCategorySummary,
	type DocumentDetail,
	type DocumentSummary,
	type DocumentUploadPolicy,
	type DocumentVersionSummary,
	type GrantDocumentAccessRequest,
	type UpdateDocumentRequest
} from '@beacon/shared';
import { api, apiDownload, apiSend, apiUpload } from './client';

/** The documents half of the REST API. Every shape comes from `@beacon/shared`. */

export function listDocuments(
	filter: { categoryId?: string; userId?: string } = {}
): Promise<DocumentSummary[]> {
	const params = new URLSearchParams();
	if (filter.categoryId) params.set('categoryId', filter.categoryId);
	if (filter.userId) params.set('userId', filter.userId);

	const query = params.toString();
	return api<DocumentSummary[]>(`/documents${query ? `?${query}` : ''}`);
}

export function getDocument(id: string): Promise<DocumentDetail> {
	return api<DocumentDetail>(`/documents/${id}`);
}

export function listVersions(id: string): Promise<DocumentVersionSummary[]> {
	return api<DocumentVersionSummary[]>(`/documents/${id}/versions`);
}

/**
 * The document's own bytes, served by the API rather than by the object store — that
 * store is internal to the server, so nothing it could sign is reachable from here.
 * Never called ahead of the click that needs it: this transfers the whole file.
 */
export function downloadDocument(
	id: string,
	versionId?: string
): Promise<{ blob: Blob; filename: string | null }> {
	return apiDownload(`/documents/${id}/download${versionId ? `?versionId=${versionId}` : ''}`);
}

export function getUploadPolicy(): Promise<DocumentUploadPolicy> {
	return api<DocumentUploadPolicy>('/documents/upload-policy');
}

export class UploadRejected extends Error {
	constructor(readonly key: 'errors.documentTooLarge' | 'errors.documentType') {
		super(key);
	}
}

/**
 * Refuses a file the server would refuse anyway, before it is sent — a 20 MB upload
 * is not worth spending to discover the type was wrong. The server still enforces
 * both limits itself; this is a courtesy, not the boundary.
 */
function preflight(file: File): void {
	if (file.size > MAX_DOCUMENT_BYTES) throw new UploadRejected('errors.documentTooLarge');
	if (!(ACCEPTED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
		throw new UploadRejected('errors.documentType');
	}
}

export function uploadDocument(
	file: File,
	fields: CreateDocumentRequest
): Promise<DocumentSummary> {
	preflight(file);

	const form = new FormData();
	form.set('file', file);
	form.set('title', fields.title);
	form.set('categoryId', fields.categoryId);
	if (fields.ownerId) form.set('ownerId', fields.ownerId);
	if (fields.organizationWide) form.set('organizationWide', 'true');
	if (fields.retentionUntil) form.set('retentionUntil', fields.retentionUntil);

	return apiUpload<DocumentSummary>('/documents', form);
}

export function uploadVersion(id: string, file: File): Promise<DocumentVersionSummary> {
	preflight(file);

	const form = new FormData();
	form.set('file', file);

	return apiUpload<DocumentVersionSummary>(`/documents/${id}/versions`, form);
}

export function updateDocument(id: string, body: UpdateDocumentRequest): Promise<DocumentSummary> {
	return apiSend<DocumentSummary>(`/documents/${id}`, 'PATCH', body);
}

export function deleteDocument(id: string): Promise<void> {
	return apiSend<void>(`/documents/${id}`, 'DELETE');
}

export function grantAccess(
	id: string,
	body: GrantDocumentAccessRequest
): Promise<DocumentAccessSummary> {
	return apiSend<DocumentAccessSummary>(`/documents/${id}/access`, 'POST', body);
}

export function revokeAccess(id: string, accessId: string): Promise<void> {
	return apiSend<void>(`/documents/${id}/access/${accessId}`, 'DELETE');
}

export function listCategories(includeInactive = false): Promise<DocumentCategorySummary[]> {
	return api<DocumentCategorySummary[]>(
		`/document-categories${includeInactive ? '?includeInactive=true' : ''}`
	);
}

export function createCategory(body: {
	key: string;
	name: string;
	position?: number;
}): Promise<DocumentCategorySummary> {
	return apiSend<DocumentCategorySummary>('/document-categories', 'POST', body);
}

export function retireCategory(id: string): Promise<DocumentCategorySummary> {
	return apiSend<DocumentCategorySummary>(`/document-categories/${id}`, 'DELETE');
}
