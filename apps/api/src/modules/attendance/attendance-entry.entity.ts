import { Collection, Entity, Enum, Index, ManyToOne, OneToMany, Property, type Ref } from '@mikro-orm/core';
import type { ApprovalStatus, AttendanceSource } from '@beacon/shared';
import { APPROVAL_STATUSES, ATTENDANCE_SOURCES } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { BreakEntry } from './break-entry.entity.js';

/**
 * One stretch of worked time. `endedAt` is null while the clock runs, and at most one
 * such row may exist per user — the service enforces it, and the timeline would be
 * ambiguous otherwise.
 */
@Entity({ tableName: 'attendance_entries' })
@Index({ properties: ['user', 'localDate'] })
// The one-open-entry rule, at the level that can actually guarantee it. The service
// checks first and gives a readable error; this stops two racing clock-ins from
// leaving a timeline nobody can total.
@Index({
  name: 'attendance_entries_one_open_per_user',
  expression:
    'create unique index "attendance_entries_one_open_per_user" on "attendance_entries" ("user_id") where "ended_at" is null',
})
export class AttendanceEntry extends OrganizationScopedEntity {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @Property({ type: 'timestamptz' })
  startedAt!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  endedAt: Date | null = null;

  /**
   * The local calendar date the entry belongs to, resolved from the user's zone when
   * the clock started. Stored rather than derived: a week query would otherwise have
   * to convert every row in SQL, and an entry that starts at 23:30 must not migrate
   * to another day when the user later changes their timezone.
   */
  @Property({ type: 'date' })
  localDate!: string;

  @Enum({ items: () => ATTENDANCE_SOURCES, type: 'string', default: 'web' })
  source: AttendanceSource = 'web';

  @Property({ type: 'string', length: 500, nullable: true })
  note: string | null = null;

  /** Clocked time is approved on the spot; a correction arrives pending. */
  @Enum({ items: () => APPROVAL_STATUSES, type: 'string', default: 'approved' })
  approvalStatus: ApprovalStatus = 'approved';

  @OneToMany(() => BreakEntry, (entry) => entry.entry, { orphanRemoval: true })
  breaks = new Collection<BreakEntry>(this);
}
