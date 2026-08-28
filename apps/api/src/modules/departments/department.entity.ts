import { Entity, Property, Unique } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * A department groups people for filtering, reporting and document access. It is
 * deliberately flat — the canvas's people list filters by one level, and a tree would
 * need a designed editor before it earns its complexity.
 */
@Entity({ tableName: 'departments' })
@Unique({ properties: ['organization', 'name'] })
export class Department extends OrganizationScopedEntity {
  @Property({ type: 'string', length: 120 })
  name!: string;
}
