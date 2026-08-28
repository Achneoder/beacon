import type { EntityManager } from '@mikro-orm/postgresql';
import { formatEmployeeNumber, parseEmployeeNumber } from '@beacon/shared';
import { User } from './user.entity.js';

/**
 * Namespace for the lock below, so it cannot collide with another advisory lock. The
 * two-argument form takes two `int4`s, which is why this is small and why the cast
 * below is explicit — `hashtext` already returns one.
 */
const EMPLOYEE_NUMBER_LOCK = 20_260_002;

/**
 * `BCN-0148` — one past the highest number the organization has issued. Hand-typed
 * numbers are skipped rather than parsed, so a custom scheme never blocks the next
 * automatic one.
 *
 * Reading the highest and writing one past it is not atomic, and
 * `(organization, employee_number)` is unique: two people accepting their invitations
 * in the same second would otherwise be handed the same number and one of them would
 * see a 500. The advisory lock is per organization and released when the caller's
 * transaction ends — which is why there has to be one.
 */
export async function nextEmployeeNumber(
  em: EntityManager,
  organizationId: string,
): Promise<string> {
  const transaction = em.getTransactionContext();
  if (!transaction) {
    throw new Error('nextEmployeeNumber must run inside a transaction — its lock ends with one');
  }

  await em
    .getConnection()
    .execute(
      'select pg_advisory_xact_lock(?::int4, hashtext(?))',
      [EMPLOYEE_NUMBER_LOCK, organizationId],
      'run',
      transaction,
    );

  const existing = await em.find(
    User,
    { organization: organizationId, employeeNumber: { $ne: null } },
    { fields: ['employeeNumber'] },
  );

  const highest = existing.reduce((max, user) => {
    const sequence = user.employeeNumber ? parseEmployeeNumber(user.employeeNumber) : null;

    return sequence && sequence > max ? sequence : max;
  }, 0);

  return formatEmployeeNumber(highest + 1);
}
