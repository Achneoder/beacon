/**
 * The one place the e2e ports live. Read by `playwright.config.ts` (which starts the
 * two servers) and by `tests/services.mjs` (which starts the containers and migrates).
 *
 * Everything is deliberately off the dev ports — a browser run must never talk to the
 * database or the API a developer has open in another terminal.
 */

export const WEB_PORT = 4173;
export const API_PORT = 3210;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api`;

export const MAILPIT_SMTP_PORT = 51025;
export const MAILPIT_URL = 'http://localhost:58025';

export const SEARCH_PORT = 57700;
export const SEARCH_URL = `http://localhost:${SEARCH_PORT}`;

export const DATABASE_URL = 'postgresql://beacon:beacon@localhost:55432/beacon_e2e';

export const COMPOSE_FILE = '../../infra/docker-compose.e2e.yml';

/**
 * Passed to the API process, not written to a file: `@nestjs/config` only fills in keys
 * that are absent from `process.env`, so these win over `apps/api/.env` and the suite
 * cannot be pointed at the dev database by a stray local setting.
 */
export const API_ENV = {
	NODE_ENV: 'test',
	PORT: String(API_PORT),
	CORS_ORIGIN: WEB_URL,
	DATABASE_URL,

	JWT_SECRET: 'e2e-secret-not-for-anything-else',
	JWT_EXPIRES_IN: '15m',
	JWT_REFRESH_EXPIRES_IN: '30d',

	AUTH_COOKIE_NAME: 'beacon_refresh',
	AUTH_COOKIE_SAME_SITE: 'lax',
	AUTH_COOKIE_SECURE: 'false',

	// Parallel browsers sign in faster than any human, and the real limits would spend
	// the run returning 429. See apps/api/src/common/auth/throttle.ts.
	THROTTLE_LIMIT: '100000',
	AUTH_THROTTLE_LIMIT: '100000',

	STORAGE_ENDPOINT: 'localhost',
	STORAGE_PORT: '59000',
	STORAGE_USE_SSL: 'false',
	STORAGE_ACCESS_KEY: 'beacon',
	STORAGE_SECRET_KEY: 'beacon-secret',
	STORAGE_BUCKET: 'beacon-e2e',
	STORAGE_ENCRYPTION: 'none',

	// The throwaway Meilisearch. The index name has to end in -e2e or the reset guard
	// in apps/api/test/search.ts refuses to run — the same rail the bucket and the
	// database each have, and for the same reason: a stray apps/api/.env would
	// otherwise aim a suite that wipes an index at the developer's own.
	SEARCH_HOST: 'localhost',
	SEARCH_PORT: String(SEARCH_PORT),
	SEARCH_USE_SSL: 'false',
	SEARCH_API_KEY: 'beacon-search-key',
	SEARCH_INDEX: 'beacon-e2e',

	// The throwaway Mailpit. Every invitation the suite creates lands there instead of
	// a real inbox, and MAILPIT_URL is how a spec reads it back.
	MAIL_HOST: 'localhost',
	MAIL_PORT: String(MAILPIT_SMTP_PORT),
	MAIL_SECURE: 'false',
	MAIL_FROM: 'Beacon <beacon@e2e.local>',
	WEB_BASE_URL: WEB_URL,

	// A fixed key, not a generated one — this run's ciphertexts never need to outlive
	// the throwaway database. Real enough to exercise SecretCipher end to end.
	SSO_ENCRYPTION_KEY: '4FRKhSQf1jnMcFpYuNqjKrC0YWYCjFbud52rd0I9pFE=',
	API_PUBLIC_URL: API_URL.replace(/\/api$/, '')
};
