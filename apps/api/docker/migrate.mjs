/**
 * Migration entry point for the container. `dist/main.js` never migrates — schema
 * changes ship as migrations and are applied deliberately, by the one-shot `migrate`
 * service the deployment compose file runs before the api starts.
 *
 * The MikroORM CLI is a devDependency and is not in the runtime image, so this drives
 * the Migrator directly — `@mikro-orm/migrations` is a production dependency and is
 * already registered in `createOrmConfig`'s `extensions`.
 *
 * Run from the api package directory, like the server: `migrations.path` is relative.
 */
import { MikroORM } from '@mikro-orm/postgresql';
import { createOrmConfig } from '../dist/mikro-orm.config.js';

const clientUrl = process.env.DATABASE_URL;
if (!clientUrl) {
  console.error('DATABASE_URL is required to run migrations');
  process.exit(1);
}

const orm = await MikroORM.init({ ...createOrmConfig(clientUrl), debug: false });
try {
  const applied = await orm.getMigrator().up();
  console.log(
    applied.length === 0
      ? 'schema is up to date'
      : `applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`,
  );
} finally {
  await orm.close(true);
}
