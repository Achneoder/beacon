import { Entity, Index, ManyToOne, Property, Unique, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';

/**
 * What one finished day contributed, materialised.
 *
 * The overtime balance is a running total, and a running total can only be adjusted
 * safely if the last figure it was given is written down: an amended Tuesday has to
 * move the balance by the *difference* it made, not add its hours a second time.
 * Holding that figure in memory would lose it on every restart, so it is a row.
 *
 * The timesheet does not read this — it recomputes from the entries, because the
 * current day is still moving. This is the ledger, not the report.
 */
@Entity({ tableName: 'attendance_days' })
@Index({ properties: ['organization', 'localDate'] })
@Unique({ properties: ['user', 'localDate'] })
export class AttendanceDay extends OrganizationScopedEntity<'workedMinutes' | 'targetMinutes' | 'balanceMinutes'> {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @Property({ type: 'date' })
  localDate!: string;

  @Property({ type: 'integer', default: 0 })
  workedMinutes: number = 0;

  @Property({ type: 'integer', default: 0 })
  targetMinutes: number = 0;

  /** Worked minus target, credited days honoured — the figure applied to the balance. */
  @Property({ type: 'integer', default: 0 })
  balanceMinutes: number = 0;
}
