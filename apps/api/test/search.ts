import { Meilisearch } from 'meilisearch';

/**
 * Talks to the throwaway Meilisearch from `infra/docker-compose.e2e.yml` directly
 * through the `meilisearch` SDK. `CLAUDE.md`'s "never import a vendor SDK from feature
 * code" rule governs code behind `SearchService`; a test that verifies the search seam
 * itself has to speak to the backend — the same exemption `mailpit.ts` takes for SMTP
 * and `storage.ts` for the object store.
 */
function client(): Meilisearch {
  const host = process.env.SEARCH_HOST ?? 'localhost';
  const port = process.env.SEARCH_PORT ?? '7700';

  return new Meilisearch({
    host: /^https?:\/\//.test(host) ? host : `http://${host}:${port}`,
    apiKey: process.env.SEARCH_API_KEY,
  });
}

function indexUid(): string {
  return process.env.SEARCH_INDEX ?? '';
}

/**
 * The guard rail — the exact mirror of `assertThrowawayBucket` in `storage.ts` and
 * `assertThrowawayDatabase` in `instance.ts`. This suite empties whatever index it is
 * pointed at, and the API-side vitest config once pinned the database and mail to the
 * throwaway compose project while leaving storage aimed at the dev bucket. The same
 * mistake is available here, so the same rail goes in: the index has to *name itself*
 * disposable before anything is deleted.
 */
function assertThrowawayIndex(): void {
  const uid = indexUid();

  if (!uid.endsWith('-e2e')) {
    throw new Error(
      `refusing to reset "${uid || '(unset SEARCH_INDEX)'}": the e2e suite only runs against an index whose name ends in -e2e`,
    );
  }
}

/**
 * Empties the index, so one run's uploads are never found by the next. Call it
 * alongside `resetInstance` and `resetBucket` in `beforeAll` — a hit whose row was
 * truncated away resolves to nothing and would look like the visibility filter
 * working when it is really just a stale index.
 */
export async function resetSearchIndex(): Promise<void> {
  assertThrowawayIndex();

  const meili = client();
  const uid = indexUid();

  // The index is created lazily by MeilisearchSearchService.onModuleInit, so a fresh
  // set of containers — before the API has ever booted against them — has none yet.
  try {
    await meili.getRawIndex(uid);
  } catch {
    return;
  }

  await meili.index(uid).deleteAllDocuments().waitTask();
}

/**
 * Indexing is fire-and-forget by design — `SearchSubscriber` never blocks a write on
 * the search backend — so a spec that uploads and then searches is racing a write it
 * deliberately did not wait for. Polling is the honest way to assert on that, rather
 * than a fixed sleep that is either flaky or slow.
 */
export async function until<T>(
  produce: () => Promise<T>,
  satisfied: (value: T) => boolean,
  { timeoutMs = 10_000, intervalMs = 100 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await produce();

  while (!satisfied(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await produce();
  }

  return last;
}
