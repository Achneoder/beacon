import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { ENTITIES } from './entities.js';

/**
 * Schema changes ship as migrations — never as auto-synchronisation.
 */
export function createOrmConfig(clientUrl: string) {
  return defineConfig({
    // Explicit driver is required when the Nest module builds config via useFactory.
    driver: PostgreSqlDriver,
    clientUrl,
    entities: ENTITIES,
    extensions: [Migrator],
    migrations: {
      path: 'dist/migrations',
      pathTs: 'src/migrations',
      snapshot: false,
    },
    debug: process.env.NODE_ENV !== 'production',
  });
}
