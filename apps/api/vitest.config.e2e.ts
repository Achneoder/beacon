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
    },
  },
});
