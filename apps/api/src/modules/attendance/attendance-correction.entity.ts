import { Entity, Enum, Index, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import type { ApprovalStatus, CorrectionKind } from '@beacon/shared';
import { APPROVAL_STATUSES, CORRECTION_KINDS } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { AttendanceEntry } from './attendance-entry.entity.js';

/**
 * The way a locked week changes. Once the grace window has passed an entry is no
 * longer editable, so the employee asks and their manager decides — the same
 * `User.manager` edge absence requests will route along.
 */
@Entity({ tableName: 'attendance_corrections' })
@Index({ properties: ['organization', 'status'] })
export class AttendanceCorrection extends OrganizationScopedEntity {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  /** The entry being amended or removed; null when one is being added. */
  @ManyToOne(() => AttendanceEntry, { ref: true, nullable: true, deleteRule: 'set null' })
  entry: Ref<AttendanceEntry> | null = null;

  @Enum({ items: () => CORRECTION_KINDS, type: 'string' })
  kind!: CorrectionKind;

  /** Resolved from the requester's zone, so an approval queue can group by day. */
  @Property({ type: 'date' })
  localDate!: string;

  @Property({ type: 'timestamptz', nullable: true })
  startedAt: Date | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  endedAt: Date | null = null;

  @Property({ type: 'integer', default: 0 })
  breakMinutes: number = 0;

  @Property({ type: 'string', length: 1000 })
  reason!: string;

  @Enum({ items: () => APPROVAL_STATUSES, type: 'string', default: 'pending' })
  status: ApprovalStatus = 'pending';

  /** The manager it was routed to when it was raised, kept even if that edge moves. */
  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  approver: Ref<User> | null = null;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  decidedBy: Ref<User> | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null = null;

  @Property({ type: 'string', length: 1000, nullable: true })
  decisionNote: string | null = null;
}
