/**
 * Brings up everything the browser suite needs *behind* the two servers Playwright
 * starts: the throwaway Postgres and MinIO, a compiled API, and an up-to-date schema.
 *
 * Kept out of Playwright's `globalSetup` on purpose — it runs before the web servers
 * are launched, it is worth being able to run on its own while debugging, and its
 * output belongs in the terminal rather than a test report.
 *
 * Usage: `node tests/services.mjs` (or `pnpm --filter web test:e2e`, which chains it).
 * Set `E2E_SKIP_DOCKER=1` to reuse containers you already have up.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API_ENV, COMPOSE_FILE, DATABASE_URL } from './environment.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

/** @param {string} label @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
function run(label, argv, env = {}) {
	process.stdout.write(`\n▸ ${label}\n`);
	const result = spawnSync(argv[0], argv.slice(1), {
		cwd,
		stdio: 'inherit',
		env: { ...process.env, ...env }
	});

	if (result.error) throw result.error;
	if (result.status !== 0) {
		process.stderr.write(`\n${label} failed (exit ${result.status}).\n`);
		process.exit(result.status ?? 1);
	}
}

if (process.env.E2E_SKIP_DOCKER !== '1') {
	// --wait blocks on the healthchecks, so migrating straight afterwards is safe.
	run('starting e2e postgres and minio', [
		'docker',
		'compose',
		'-f',
		COMPOSE_FILE,
		'up',
		'-d',
		'--wait'
	]);
}

// The API runs from dist/ rather than through `nest start`, so Playwright's shutdown
// kills the server itself and not a compiler wrapping it.
run('building the api', ['pnpm', '--filter', 'api', 'build']);

// The CLI loads .env only when DATABASE_URL is unset, so this cannot hit dev data.
run('migrating the e2e database', ['pnpm', '--filter', 'api', 'mikro-orm', 'migration:up'], {
	DATABASE_URL,
	NODE_ENV: API_ENV.NODE_ENV
});

process.stdout.write('\n✓ e2e services ready\n');
