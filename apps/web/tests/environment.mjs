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

	// The throwaway Mailpit. Every invitation the suite creates lands there instead of
	// a real inbox, and MAILPIT_URL is how a spec reads it back.
	MAIL_HOST: 'localhost',
	MAIL_PORT: String(MAILPIT_SMTP_PORT),
	MAIL_SECURE: 'false',
	MAIL_FROM: 'Beacon <beacon@e2e.local>',
	WEB_BASE_URL: WEB_URL
};
