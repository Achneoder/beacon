import { Collection, Entity, Enum, ManyToMany, Property, Unique } from '@mikro-orm/core';
import type { Permission } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { Role } from '../roles/role.entity.js';

export enum UserStatus {
  Invited = 'invited',
  Active = 'active',
  Disabled = 'disabled',
}

/**
 * Users belong to exactly one organization — an address may sign up again elsewhere,
 * so email is unique per organization rather than globally.
 */
@Entity({ tableName: 'users' })
@Unique({ properties: ['organization', 'email'] })
export class User extends OrganizationScopedEntity<'permissions'> {
  /** Always stored lower-cased so lookups can compare directly. */
  @Property({ type: 'string', length: 320 })
  email!: string;

  /** Null for users who authenticate another way — SSO and passkeys are planned. */
  @Property({ type: 'string', length: 255, nullable: true })
  passwordHash: string | null = null;

  @Property({ type: 'string', length: 100 })
  firstName!: string;

  @Property({ type: 'string', length: 100 })
  lastName!: string;

  @Enum({ items: () => UserStatus, type: 'string', default: UserStatus.Active })
  status: UserStatus = UserStatus.Active;

  @Property({ type: 'string', length: 10, default: 'en' })
  locale: string = 'en';

  @Property({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null = null;

  @ManyToMany({ entity: () => Role, owner: true, pivotTable: 'user_roles' })
  roles = new Collection<Role>(this);

  /**
   * The union of every permission the user's roles grant. The single place this set is
   * assembled — the JWT payload and /auth/me both read it, so they cannot drift.
   * Requires `roles` to be populated.
   */
  get permissions(): Permission[] {
    return [...new Set(this.roles.getItems().flatMap((role) => role.permissions))];
  }
}
