import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type {
	DocumentCategorySummary,
	DocumentDetail,
	DocumentSummary,
	DocumentUploadPolicy
} from '@beacon/shared';
import '$lib/i18n';
import DocumentsPage from './+page.svelte';
import * as documents from '$lib/api/documents';
import * as people from '$lib/api/people';
import * as client from '$lib/api/client';
import { session } from '$lib/auth/session.svelte';

const categories: DocumentCategorySummary[] = [
	{ id: 'c1', key: 'payslips', name: 'Payslips', position: 1, active: true },
	{ id: 'c2', key: 'sick-notes', name: 'Sick notes', position: 5, active: true }
];

const policy: DocumentUploadPolicy = {
	maxBytes: 20 * 1024 * 1024,
	acceptedTypes: ['application/pdf'],
	acceptedExtensions: ['.pdf'],
	encryptedAtRest: false
};

const doc: DocumentSummary = {
	id: 'd1',
	title: 'Payslip January',
	categoryId: 'c1',
	categoryName: 'Payslips',
	ownerId: 'u1',
	ownerName: 'Ada Lovelace',
	scope: 'personal',
	versionId: 'v1',
	versionNumber: 1,
	size: 812 * 1024,
	contentType: 'application/pdf',
	filename: 'payslip.pdf',
	uploadedAt: '2026-08-12T09:00:00.000Z',
	uploadedById: 'u1',
	uploadedByName: 'Ada Lovelace',
	retentionUntil: null,
	canWrite: true,
	canManage: false
};

const detail: DocumentDetail = {
	...doc,
	versions: [
		{
			id: 'v1',
			versionNumber: 1,
			size: doc.size,
			contentType: 'application/pdf',
			filename: 'payslip.pdf',
			checksum: 'abc',
			uploadedAt: doc.uploadedAt,
			uploadedById: 'u1',
			uploadedByName: 'Ada Lovelace'
		}
	],
	access: []
};

function grant(...permissions: string[]) {
	vi.spyOn(session, 'can').mockImplementation((p) => permissions.includes(p));
}

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(documents, 'listCategories').mockResolvedValue(categories);
	vi.spyOn(documents, 'getUploadPolicy').mockResolvedValue(policy);
	vi.spyOn(documents, 'listDocuments').mockResolvedValue([doc]);
	vi.spyOn(documents, 'getDocument').mockResolvedValue(detail);
	// The access panel's own picker lists — irrelevant to every test but the last,
	// and stubbed here so none of them makes a real network call.
	vi.spyOn(people, 'listPeople').mockResolvedValue([]);
	vi.spyOn(people, 'listDepartments').mockResolvedValue([]);
	vi.spyOn(client, 'api').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('documents page', () => {
	it('lists documents with their category and size', async () => {
		grant('document:read');
		render(DocumentsPage);

		expect(await screen.findByText('Payslip January')).toBeInTheDocument();
		expect(screen.getByRole('cell', { name: 'Payslips' })).toBeInTheDocument();
		expect(screen.getByText('812 KB')).toBeInTheDocument();
	});

	it('selecting a category chip asks the API to filter', async () => {
		grant('document:read');
		render(DocumentsPage);
		await screen.findByText('Payslip January');

		await fireEvent.click(screen.getByRole('button', { name: 'Sick notes' }));

		await waitFor(() => expect(documents.listDocuments).toHaveBeenCalledWith({ categoryId: 'c2' }));
	});

	it('offers the dropzone to someone who can write, not to someone who cannot', async () => {
		grant('document:read', 'document:write');
		const { unmount } = render(DocumentsPage);
		await screen.findByText('Payslip January');
		expect(screen.getByText('PDF, DOCX or JPG · max 20 MB')).toBeInTheDocument();
		unmount();

		grant('document:read');
		render(DocumentsPage);
		await screen.findByText('Payslip January');
		expect(screen.queryByText('PDF, DOCX or JPG · max 20 MB')).not.toBeInTheDocument();
	});

	it('opens the detail panel for a row and shows its version history', async () => {
		grant('document:read');
		render(DocumentsPage);

		await fireEvent.click(await screen.findByText('Payslip January'));

		expect(documents.getDocument).toHaveBeenCalledWith('d1');
		expect(await screen.findByText('Version history')).toBeInTheDocument();
		expect(screen.getByText('v1')).toBeInTheDocument();
	});

	it('does not offer the access panel to someone without document:manage', async () => {
		grant('document:read');
		render(DocumentsPage);

		await fireEvent.click(await screen.findByText('Payslip January'));
		await screen.findByText('Version history');

		expect(screen.queryByText('Who can see this')).not.toBeInTheDocument();
	});

	it('offers the access panel once the detail reports canManage', async () => {
		vi.spyOn(documents, 'getDocument').mockResolvedValue({ ...detail, canManage: true });
		grant('document:read', 'document:manage');
		render(DocumentsPage);

		await fireEvent.click(await screen.findByText('Payslip January'));

		expect(await screen.findByText('Who can see this')).toBeInTheDocument();
	});
});
