import { DecimalType, Entity, Property } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * Something time is booked and billed against. `clientName` is a free-text tag, not a
 * relation — this phase has no `Client` entity, so grouping and filtering by client
 * reads this column directly.
 *
 * No `key` column, unlike `DocumentCategory`/`AbsenceType`: those are seeded built-ins
 * addressed by a stable slug, while a project is pure user data with no seed to name.
 */
@Entity({ tableName: 'projects' })
export class Project extends OrganizationScopedEntity {
  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 200, nullable: true })
  clientName: string | null = null;

  @Property({ type: 'string', length: 1000, nullable: true })
  description: string | null = null;

  /**
   * The rate a booking freezes onto its `TimeEntry.rateAtEntry` unless a task
   * overrides it. `null` means "not billable by default" — see `effectiveHourlyRate`.
   */
  @Property({ type: new DecimalType('number'), precision: 10, scale: 2, nullable: true })
  hourlyRate: number | null = null;

  /** Retired rather than deleted: a past `TimeEntry` must keep naming it. */
  @Property({ type: 'boolean', default: true })
  active: boolean = true;
}
