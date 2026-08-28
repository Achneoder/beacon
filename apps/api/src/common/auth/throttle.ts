/**
 * Rate limits, in one place because they have to be readable from a decorator.
 *
 * `@Throttle(...)` is evaluated when the controller module is imported, which happens
 * before `ConfigModule` runs — so these read the real process environment rather than
 * `ConfigService`, and a value in `.env` will *not* reach them. The only caller that
 * sets them is the browser e2e harness (`apps/web/playwright.config.ts`), which passes
 * them to the API process directly: a dozen parallel browsers sign in far faster than
 * a human ever would, and would otherwise spend the run being told to wait a minute.
 */
function limitFrom(name: string, fallback: number): number {
  const raw = Number(process.env[name]);

  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** A baseline for every route. */
export const DEFAULT_THROTTLE_LIMIT = limitFrom('THROTTLE_LIMIT', 120);

/** Password endpoints are the obvious brute-force target, so they are limited hard. */
export const PASSWORD_THROTTLE = {
  auth: { ttl: 60_000, limit: limitFrom('AUTH_THROTTLE_LIMIT', 10) },
};
