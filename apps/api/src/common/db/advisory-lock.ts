import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * A Postgres advisory lock held for the rest of the caller's transaction.
 *
 * Read-then-write sequences that have no stable row to lock — or that must not hold
 * a row lock while they write elsewhere — serialize on one of these instead: the
 * check and the write are only atomic together while a competing transaction with
 * the same key is made to wait. `pg_advisory_xact_lock` releases with the
 * transaction, so there is nothing to unlock and no orphaned lock after a crash.
 *
 * The two-argument form takes two `int4`s — the namespace constant each caller
 * defines keeps its key space separate, and `hashtext` turns the entity id into the
 * second one. Callers must run inside `em.transactional`, same as
 * {@link nextEmployeeNumber} documents for its own lock.
 */
export async function lockAdvisory(
  em: EntityManager,
  namespace: number,
  key: string,
): Promise<void> {
  await em
    .getConnection()
    .execute(
      'select pg_advisory_xact_lock(?::int4, hashtext(?))',
      [namespace, key],
      'run',
      em.getTransactionContext(),
    );
}
