import type { MikroORM } from '@mikro-orm/core';

/**
 * Empties the e2e database.
 *
 * Beacon installs one organization per deployment: `POST /auth/register` succeeds
 * exactly once and 409s forever after. Every spec file here registers its own, so each
 * one has to start from an uninstalled instance — hence a reset rather than the scoped
 * teardown this suite used to run afterwards. `fileParallelism` is off in
 * `vitest.config.e2e.ts` so two files never reset each other mid-run.
 *
 * Truncation is read from the catalogue rather than a hand-kept list, so a new entity
 * needs no change here.
 */
export async function resetInstance(orm: MikroORM): Promise<void> {
  assertThrowawayDatabase();

  const em = orm.em.fork();
  const tables: Array<{ tablename: string }> = await em.getConnection().execute(
    `select tablename from pg_tables
     where schemaname = 'public' and tablename <> 'mikro_orm_migrations'`,
  );

  if (tables.length === 0) return;

  await em
    .getConnection()
    .execute(
      `truncate table ${tables.map((table) => `"${table.tablename}"`).join(', ')} restart identity cascade`,
    );
}

/**
 * The guard rail. This suite wipes every table it can see, and the one time it was
 * pointed at the dev database it signed the developer out of their own organization —
 * so the database has to *name itself* disposable before anything is dropped.
 */
function assertThrowawayDatabase(): void {
  const url = process.env.DATABASE_URL;
  const name = url ? new URL(url).pathname.replace(/^\//, '') : '';

  if (!name.endsWith('_e2e')) {
    throw new Error(
      `refusing to reset "${name || '(unset DATABASE_URL)'}": the e2e suite only runs against a database whose name ends in _e2e`,
    );
  }
}
