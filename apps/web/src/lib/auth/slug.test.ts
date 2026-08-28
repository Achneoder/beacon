import { describe, expect, it } from 'vitest';
import { previewSlug } from './slug';

describe('previewSlug', () => {
	it('matches what the API derives from the same name', () => {
		expect(previewSlug('Acme Industries')).toBe('acme-industries');
		expect(previewSlug('Groß Büro Köln')).toBe('gross-buero-koeln');
		expect(previewSlug('  Acme, Inc. — Ltd!  ')).toBe('acme-inc-ltd');
	});

	it('is empty while the name has nothing usable in it', () => {
		expect(previewSlug('***')).toBe('');
	});
});
