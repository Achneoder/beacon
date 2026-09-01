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
export class Role extends OrganizationScopedEntity<'customized'> {
  @Property({ type: 'string', length: 64 })
  key!: string;

  @Property({ type: 'string', length: 100 })
  name!: string;

  @Property({ type: 'json' })
  permissions: Permission[] = [];

  /** Seeded from DEFAULT_ROLES; system roles are not deletable by the organization. */
  @Property({ type: 'boolean', default: false })
  isSystem: boolean = false;

  /**
   * Set the first time an organization edits a system role's permissions, and never
   * unset.
   *
   * `OrganizationService.reconcileSystemRoles` re-syncs every system role from
   * `DEFAULT_ROLES` at boot, so a new permission added by an upgrade reaches existing
   * installations without a hand-written backfill. That is only safe while nobody has
   * edited the role: without this flag the very next restart would silently undo the
   * organization's own change. Drift alone cannot tell the two apart — an edited role
   * and a role awaiting a new default look identical — so the fact is recorded rather
   * than inferred.
   *
   * Named in the class's `OptionalProps` parameter so `em.create` does not demand it:
   * no role is ever born customized.
   */
  @Property({ type: 'boolean', default: false })
  customized: boolean = false;
}
