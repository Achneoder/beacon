import { Entity, Property, Unique } from '@mikro-orm/core';
import type { Permission } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * A named bundle of permissions, owned by one organization. The seeded roles from
 * DEFAULT_ROLES are marked `isSystem`; organizations may add their own alongside them.
 *
 * Application code never branches on `key` — it checks the permissions a role carries.
 */
@Entity({ tableName: 'roles' })
@Unique({ properties: ['organization', 'key'] })
export class Role extends OrganizationScopedEntity {
  @Property({ type: 'string', length: 64 })
  key!: string;

  @Property({ type: 'string', length: 100 })
  name!: string;

  @Property({ type: 'json' })
  permissions: Permission[] = [];

  /** Seeded from DEFAULT_ROLES; system roles are not deletable by the organization. */
  @Property({ type: 'boolean', default: false })
  isSystem: boolean = false;
}
