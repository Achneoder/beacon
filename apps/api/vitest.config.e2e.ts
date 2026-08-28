import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * The throwaway Postgres from `infra/docker-compose.e2e.yml` — a tmpfs that dies with
 * the container.
 *
 * Set here rather than left to `apps/api/.env`, which points at the *dev* database.
 * This suite registers real organizations and tears them down again, so pointing it at
 * a database anyone cares about is a data-loss bug waiting to happen — and was one:
 * the teardown below used to delete the role pivots unscoped, which wiped every
 * account's roles in whatever database it was aimed at.
 *
 * `@nestjs/config` only fills in keys absent from `process.env`, so this wins over the
 * `.env` file. An explicit `DATABASE_URL` in the environment still wins over both, for
 * CI that provisions its own.
 */
const E2E_DATABASE_URL = 'postgresql://beacon:beacon@localhost:55432/beacon_e2e';

/** The throwaway Mailpit from the same compose project. Same reasoning as the database:
 * a suite that invites people must not reach a relay that would actually deliver. */
const E2E_MAIL_PORT = '51025';

/**
 * The throwaway MinIO from the same compose project. Same reasoning as the database
 * above, and the same pattern: pinned here rather than left to `apps/api/.env`, which
 * points at the *dev* bucket. Must match `STORAGE_*` in `apps/web/tests/environment.mjs`
 * — a plain JS file a TS config here cannot import without dragging it across a
 * project boundary `tsc` refuses (it sits outside this package's `rootDir`).
 * Documents specs upload real bytes; without this the suite would write into, and its
 * reset would delete from, the dev bucket.
 */
const E2E_STORAGE_ENV = {
  STORAGE_ENDPOINT: 'localhost',
  STORAGE_PORT: '59000',
  STORAGE_USE_SSL: 'false',
  STORAGE_ACCESS_KEY: 'beacon',
  STORAGE_SECRET_KEY: 'beacon-secret',
  STORAGE_BUCKET: 'beacon-e2e',
  STORAGE_ENCRYPTION: 'none',
};

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Each file installs its own organization, and an installation holds exactly one —
    // so the files take turns rather than fighting over the same instance.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? E2E_DATABASE_URL,
      MAIL_HOST: 'localhost',
      MAIL_PORT: E2E_MAIL_PORT,
      MAIL_SECURE: 'false',
      MAIL_FROM: 'Beacon <beacon@e2e.local>',
      WEB_BASE_URL: 'http://localhost:4173',
      ...E2E_STORAGE_ENV,
    },
  },
});
