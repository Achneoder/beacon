import { Entity, Enum, Index, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import type { WorkModel } from '@beacon/shared';
import { WORK_MODELS } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';

/**
 * The hours a person is expected to work, effective-dated: a contract change adds a
 * row instead of editing history, so a timesheet from before the change still
 * measures against the target that applied then.
 */
@Entity({ tableName: 'work_schedules' })
@Index({ properties: ['user', 'effectiveFrom'] })
export class WorkSchedule extends OrganizationScopedEntity {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @Enum({ items: () => WORK_MODELS, type: 'string', default: 'flextime' })
  model: WorkModel = 'flextime';

  @Property({ type: 'integer' })
  weeklyMinutes!: number;

  /**
   * Expected minutes per weekday, Monday-first. Stored as seven numbers rather than
   * divided from the weekly figure on the fly — an organization that works four long
   * days is normal, and `weekly / 5` is only the default a new schedule starts from.
   */
  @Property({ type: 'json' })
  expectedMinutes!: number[];

  /** Local wall-clock times, `HH:MM`. Which apply depends on `model`. */
  @Property({ type: 'string', length: 5, nullable: true })
  coreStart: string | null = null;

  @Property({ type: 'string', length: 5, nullable: true })
  coreEnd: string | null = null;

  @Property({ type: 'string', length: 5, nullable: true })
  startTime: string | null = null;

  @Property({ type: 'string', length: 5, nullable: true })
  endTime: string | null = null;

  @Property({ type: 'string', length: 120, nullable: true })
  rosterRef: string | null = null;

  @Property({ type: 'date' })
  effectiveFrom!: string;
}
