import { defineConfig, devices } from '@playwright/test';
import { API_ENV, API_PORT, API_URL, WEB_PORT, WEB_URL } from './tests/environment.mjs';

/**
 * Browser e2e: the built SPA against a real NestJS API and a real Postgres.
 *
 * The unit suites (`pnpm --filter web test`) mount components against a mocked client;
 * this one proves the contract — CORS, the refresh cookie, the permission set in the
 * token, the shapes in `@beacon/shared` — actually holds end to end. It is therefore
 * deliberately built and previewed rather than run through `vite dev`: that is the
 * artefact `adapter-static` produces and the thing that gets deployed.
 *
 * `tests/services.mjs` must have run first; `pnpm --filter web test:e2e` chains both.
 */
export default defineConfig({
	testDir: './tests',
	// Real HTTP, a real database and a browser — generous next to a jsdom mount.
	timeout: 30_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	// A stray `test.only` should fail the pipeline rather than quietly skip the rest.
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

	use: {
		baseURL: WEB_URL,
		// The app reads `window.navigator.language` for its initial locale, so pinning
		// this is what lets the specs assert on English copy.
		locale: 'en-GB',
		timezoneId: 'Europe/Berlin',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},

	projects: [
		// Installs the single organization the whole run shares — see tests/fixtures.ts.
		{ name: 'setup', testMatch: /instance\.setup\.ts$/ },
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			dependencies: ['setup'],
			testIgnore: /sso\.spec\.ts$/
		},
		// sso.spec.ts is the only file that flips the shared organization's SSO
		// settings, so it gets its own project: `dependencies` waits for every other
		// spec to finish before this one starts, and its own describe.serial keeps its
		// tests from racing each other within the project. See tests/sso.spec.ts.
		{
			name: 'sso',
			testMatch: /sso\.spec\.ts$/,
			use: { ...devices['Desktop Chrome'] },
			dependencies: ['chromium']
		}
	],

	webServer: [
		{
			// Compiled by tests/services.mjs, so this starts the server and nothing else.
			command: 'node dist/main.js',
			cwd: '../api',
			url: `http://localhost:${API_PORT}/api/health`,
			env: API_ENV,
			reuseExistingServer: !process.env.CI,
			// stdout stays ignored: MikroORM logs every query outside production and it
			// would bury the test output. Failures still come through stderr.
			stderr: 'pipe',
			timeout: 60_000
		},
		{
			// PUBLIC_API_URL is baked into the client bundle at build time, so it has to
			// be set for `build` and not only for `preview`.
			command: `pnpm build && pnpm preview --port ${WEB_PORT} --strictPort`,
			url: WEB_URL,
			env: { PUBLIC_API_URL: API_URL },
			reuseExistingServer: !process.env.CI,
			timeout: 180_000
		}
	]
});
