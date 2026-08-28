import { documentKindOf } from '@beacon/shared';

/** Drives the table row's icon. A coarser grouping than the exact MIME type. */
export function iconFor(contentType: string): 'pdf' | 'docx' | 'image' | 'other' {
	return documentKindOf(contentType);
}

/** `12 Aug 2026` — an upload instant, read in the user's own locale. */
export function formatUploadedAt(instant: string, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(instant));
	} catch {
		return instant.slice(0, 10);
	}
}
