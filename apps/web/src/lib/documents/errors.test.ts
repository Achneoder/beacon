import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { UploadRejected } from '$lib/api/documents';
import { documentErrorKey } from './errors';

describe('documentErrorKey', () => {
	const cases: [number, string, string][] = [
		[415, 'only pdf, docx and jpg files are accepted', 'errors.documentType'],
		[413, 'the file exceeds the 20 MB limit', 'errors.documentTooLarge'],
		[400, 'a file is required', 'errors.documentFileRequired'],
		[404, 'document not found', 'errors.documentNotFound'],
		[403, 'you may not add a version to this document', 'errors.documentNotWritable'],
		[403, "writing into someone else's documents needs document:manage", 'errors.documentNotYours'],
		[400, 'this document is retained until 2027-01-01', 'errors.documentRetained'],
		[503, 'the document store is unavailable', 'errors.documentStorageDown'],
		[409, 'another version was uploaded at the same time; try again', 'errors.documentVersionRace'],
		[400, 'that key is already in use', 'errors.documentCategoryKey']
	];

	for (const [status, message, key] of cases) {
		it(`names the rule behind "${message}"`, () => {
			expect(documentErrorKey(new ApiError(status, message))).toBe(key);
		});
	}

	it('maps a pre-flight rejection directly, without touching the API message table', () => {
		expect(documentErrorKey(new UploadRejected('errors.documentTooLarge'))).toBe(
			'errors.documentTooLarge'
		);
		expect(documentErrorKey(new UploadRejected('errors.documentType'))).toBe('errors.documentType');
	});

	it('falls back to the generic mapping for anything it does not know', () => {
		expect(documentErrorKey(new ApiError(500, 'boom'))).toBe('errors.unexpected');
		expect(documentErrorKey(new Error('offline'))).toBe('errors.network');
	});
});
