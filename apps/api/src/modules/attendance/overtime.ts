import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DEFAULT_OVERTIME_CAP_MINUTES } from '@beacon/shared';
import { OvertimeBalance } from './overtime-balance.entity.js';

/**
 * The person's running overtime bank, materialised on first touch.
 *
 * A free function rather than a method for the same reason `schedules.ts` is one:
 * two modules move this balance and neither may import the other's service.
 * `AttendanceService` folds a finished day into it; `AbsencesService` debits it when
 * time off in lieu is approved, and would form a cycle if it went through attendance
 * — attendance already imports absences for `coverageOf`.
 *
 * Both writers move the balance by a *delta*, never by assignment, which is what lets
 * them share the row without either overwriting what the other banked.
 */
export async function ensureOvertimeBalance(
  em: EntityManager,
  organizationId: string,
  userId: string,
): Promise<OvertimeBalance> {
  const where = { organization: organizationId, user: userId };
  const existing = await em.findOne(OvertimeBalance, where);
  if (existing) return existing;

  // Two concurrent first reads — the timesheet and a clock-out, say — would both
  // pass the findOne above and collide on the (user) unique constraint. The upsert
  // turns the loser's insert into a no-op, and the refresh re-reads the row the
  // winner committed instead of returning the discarded stub.
  await em.upsert(
    OvertimeBalance,
    {
      // upsert hydrates without running the constructor, so the field initializers
      // never run — every constructor-assigned column (the id, both timestamps and
      // both defaults) has to be provided, or the not-null constraints bite.
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      organization: organizationId,
      user: userId,
      balanceMinutes: 0,
      capMinutes: DEFAULT_OVERTIME_CAP_MINUTES,
    },
    // Without this the driver would conflict on the primary key we just generated;
    // the guard that matters is the (user) unique constraint.
    { onConflictAction: 'ignore', onConflictFields: ['user'] },
  );

  return em.findOneOrFail(OvertimeBalance, where, { refresh: true });
}
