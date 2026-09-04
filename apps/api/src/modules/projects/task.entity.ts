import { DecimalType, Entity, Index, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { Project } from './project.entity.js';

/**
 * A finer breakdown of a project time may be booked against. No DB-level uniqueness on
 * `(project, name)` — `ProjectsService.createTask` checks for a duplicate itself, the
 * same shape `RolesService.create` uses, so a retired task's name stays reusable.
 */
@Entity({ tableName: 'tasks' })
@Index({ properties: ['organization', 'project'] })
export class Task extends OrganizationScopedEntity {
  @ManyToOne(() => Project, { ref: true })
  project!: Ref<Project>;

  @Property({ type: 'string', length: 200 })
  name!: string;

  /** Overrides `project.hourlyRate` when set — resolved by `effectiveHourlyRate`. */
  @Property({ type: new DecimalType('number'), precision: 10, scale: 2, nullable: true })
  hourlyRate: number | null = null;

  /** Retired rather than deleted: a past `TimeEntry` must keep naming it. */
  @Property({ type: 'boolean', default: true })
  active: boolean = true;
}
