import { Entity, ManyToOne, Property, Unique, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { Department } from '../departments/department.entity.js';

/**
 * A team sits inside a department, or stands alone — a cross-functional team belongs
 * to no single one, so the reference is nullable rather than forcing a placeholder.
 */
@Entity({ tableName: 'teams' })
@Unique({ properties: ['organization', 'name'] })
export class Team extends OrganizationScopedEntity {
  @Property({ type: 'string', length: 120 })
  name!: string;

  @ManyToOne(() => Department, { ref: true, nullable: true, deleteRule: 'set null' })
  department: Ref<Department> | null = null;
}
