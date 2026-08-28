/**
 * `services.mjs` shells out to this so the browser suite can wipe the throwaway
 * bucket the same way it resets the throwaway database — `resetBucket` needs the
 * `minio` SDK, and `apps/web/tests` has no dependency on it.
 */
import { resetBucket } from './storage.js';

await resetBucket();
