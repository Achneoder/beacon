import { DecimalType, Entity, Enum, Index, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import type { TimeEntrySource } from '@beacon/shared';
import { TIME_ENTRY_SOURCES } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { Project } from '../projects/project.entity.js';
import { Task } from '../projects/task.entity.js';

/**
 * Time booked against a project, independent of attendance clock-in/out. Either a
 * timer (`startedAt` set, `endedAt` null while it runs) or a manual booking (a plain
 * duration, or a start/end pair typed in after the fact).
 *
 * `rateAtEntry` and `amount` are frozen once known — at creation for a manual entry,
 * at stop time for a timer — and never re-derived from the project's current rate, the
 * frozen-cost discipline `AbsenceRequest.costDays`/`costMinutes` established.
 */
@Entity({ tableName: 'time_entries' })
@Index({ properties: ['user', 'localDate'] })
@Index({ properties: ['organization', 'project'] })
// At most one *running* timer per user. Deliberately not a copy of
// AttendanceEntry's bare `where ended_at is null`: a duration-only manual entry also
// has `ended_at` null, so the predicate must also require `started_at is not null`,
// or a user could never log more than one such entry.
@Index({
  name: 'time_entries_one_running_per_user',
  expression:
    'create unique index "time_entries_one_running_per_user" on "time_entries" ("user_id") ' +
    'where "started_at" is not null and "ended_at" is null',
})
export class TimeEntry extends OrganizationScopedEntity {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @ManyToOne(() => Project, { ref: true })
  project!: Ref<Project>;

  /** `set null` rather than restrict: a task is retired, not hard-deleted, through the
   *  API, so this only fires on a hard delete that does not happen today — the same
   *  reasoning `AbsenceRequest.document` gives its own nullable FK. */
  @ManyToOne(() => Task, { ref: true, nullable: true, deleteRule: 'set null' })
  task: Ref<Task> | null = null;

  /**
   * The local calendar date the entry belongs to, resolved from the user's zone when
   * it was created — the same reasoning as `AttendanceEntry.localDate`.
   */
  @Property({ type: 'date' })
  localDate!: string;

  @Property({ type: 'timestamptz', nullable: true })
  startedAt: Date | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  endedAt: Date | null = null;

  /** Null exactly while a timer runs. Frozen once known, never re-derived on read. */
  @Property({ type: 'integer', nullable: true })
  durationMinutes: number | null = null;

  @Property({ type: 'boolean', default: true })
  billable: boolean = true;

  /**
   * The rate frozen from `effectiveHourlyRate(project, task)` at creation. Never
   * re-read live — a later rate change must not rewrite what a past entry billed.
   */
  @Property({ type: new DecimalType('number'), precision: 10, scale: 2, nullable: true })
  rateAtEntry: number | null = null;

  /** `rateAtEntry × durationMinutes / 60`, frozen the moment the duration is known. */
  @Property({ type: new DecimalType('number'), precision: 12, scale: 2, nullable: true })
  amount: number | null = null;

  @Enum({ items: () => TIME_ENTRY_SOURCES, type: 'string', default: 'manual' })
  source: TimeEntrySource = 'manual';

  @Property({ type: 'string', length: 500, nullable: true })
  note: string | null = null;
}
