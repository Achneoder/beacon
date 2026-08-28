import { describe, expect, it } from 'vitest';
import { NoopSearchService } from './noop-search.service.js';

/**
 * An installation with no `SEARCH_HOST` is a supported deployment, so the guarantee
 * worth pinning is that every call is harmless and `available()` tells the truth —
 * that flag is what makes the web app hide the field rather than render a box that
 * returns nothing.
 */
describe('NoopSearchService', () => {
  const service = new NoopSearchService();

  it('reports that no search backend is configured', () => {
    expect(service.available()).toBe(false);
  });

  it('finds nothing and refuses to throw doing it', async () => {
    await expect(service.index()).resolves.toBeUndefined();
    await expect(service.remove()).resolves.toBeUndefined();
    await expect(service.replaceAll()).resolves.toBeUndefined();
    await expect(service.query()).resolves.toEqual([]);
  });
});
