import { createOrmConfig } from './mikro-orm.config.js';

/**
 * Config entry point for the MikroORM CLI (`pnpm --filter api mikro-orm ...`).
 *
 * The Nest app builds the same config from ConfigService instead, so .env is loaded
 * before DATABASE_URL is read. The CLI runs outside Nest, so it loads .env itself.
 */
if (!process.env.DATABASE_URL) {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file not present — fall through to the next candidate
    }
  }
}

export default createOrmConfig(process.env.DATABASE_URL ?? '');
