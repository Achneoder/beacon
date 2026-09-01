import {
  Collection,
  Entity,
  Enum,
  Index,
  ManyToMany,
  ManyToOne,
  Property,
  Unique,
  type Ref,
} from '@mikro-orm/core';
import type { ContractType, LocaleCode, Permission, WorkLocation } from '@beacon/shared';
import { CONTRACT_TYPES, WORK_LOCATIONS } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { Department } from '../departments/department.entity.js';
import { Role } from '../roles/role.entity.js';
import { Team } from '../teams/team.entity.js';

export enum UserStatus {
  Invited = 'invited',
  Active = 'active',
  Disabled = 'disabled',
}

/**
 * Users belong to exactly one organization — an address may sign up again elsewhere,
 * so email is unique per organization rather than globally.
 *
 * The employment fields are what the Profile screen displays. They are all nullable:
 * the owner created by registration has none of them, and an organization fills them
 * in at its own pace.
 */
@Entity({ tableName: 'users' })
@Unique({ properties: ['organization', 'email'] })
@Unique({ properties: ['organization', 'employeeNumber'] })
@Index({ properties: ['manager'] })
@Index({ properties: ['department'] })
@Index({ properties: ['team'] })
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

  /**
   * The person's own language. Null falls back to `Organization.defaultLocale` at the
   * edge, exactly like `timezone` below — that is what makes the organization setting
   * a *default* rather than a value only ever read once, at registration.
   */
  @Property({ type: 'string', length: 10, nullable: true })
  locale: LocaleCode | null = null;

  /** IANA zone. Null falls back to `Organization.timezone` at the edge. */
  @Property({ type: 'string', length: 64, nullable: true })
  timezone: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null = null;

  /** `BCN-0148`, unique per organization; assigned on creation, editable after. */
  @Property({ type: 'string', length: 32, nullable: true })
  employeeNumber: string | null = null;

  @Property({ type: 'string', length: 120, nullable: true })
  jobTitle: string | null = null;

  @ManyToOne(() => Department, { ref: true, nullable: true, deleteRule: 'set null' })
  department: Ref<Department> | null = null;

  @ManyToOne(() => Team, { ref: true, nullable: true, deleteRule: 'set null' })
  team: Ref<Team> | null = null;

  /**
   * The approver. Load-bearing, not decoration: absence requests and attendance
   * corrections both route to this person, and `UsersService.subordinateIdsOf` reads
   * the same edge to answer "the people I approve for".
   */
  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  manager: Ref<User> | null = null;

  @Enum({ items: () => CONTRACT_TYPES, type: 'string', nullable: true })
  contractType: ContractType | null = null;

  /** The office city; `workLocation` says how the person works from it. */
  @Property({ type: 'string', length: 120, nullable: true })
  office: string | null = null;

  @Enum({ items: () => WORK_LOCATIONS, type: 'string', nullable: true })
  workLocation: WorkLocation | null = null;

  @Property({ type: 'string', length: 40, nullable: true })
  phone: string | null = null;

  /** Plain dates, not instants — an employment start has no time of day. */
  @Property({ type: 'date', nullable: true })
  startsOn: string | null = null;

  @Property({ type: 'date', nullable: true })
  endsOn: string | null = null;

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
