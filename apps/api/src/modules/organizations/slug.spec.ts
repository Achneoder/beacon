import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('Acme Industries')).toBe('acme-industries');
  });

  it('transliterates German umlauts rather than dropping them', () => {
    expect(slugify('Groß Büro Köln')).toBe('gross-buero-koeln');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('  Acme, Inc. — Ltd!  ')).toBe('acme-inc-ltd');
  });

  it('leaves no leading or trailing hyphen', () => {
    expect(slugify('***Acme***')).toBe('acme');
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', async () => {
    await expect(uniqueSlug('acme', async () => false)).resolves.toBe('acme');
  });

  it('counts up until it finds a free candidate', async () => {
    const taken = new Set(['acme', 'acme-2']);

    await expect(uniqueSlug('acme', async (c) => taken.has(c))).resolves.toBe('acme-3');
  });

  it('falls back to a usable slug when the name yields nothing', async () => {
    await expect(uniqueSlug(slugify('***'), async () => false)).resolves.toBe('organization');
  });
});
