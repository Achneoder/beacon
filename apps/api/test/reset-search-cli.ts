/**
 * `services.mjs` shells out to this so the browser suite can wipe the throwaway search
 * index the same way it resets the throwaway database and bucket — `resetSearchIndex`
 * needs the `meilisearch` SDK, and `apps/web/tests` has no dependency on it.
 */
import { resetSearchIndex } from './search.js';

await resetSearchIndex();
