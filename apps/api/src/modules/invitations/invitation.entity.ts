import { Collection, Entity, Enum, Index, ManyToMany, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import type { ContractType, WorkLocation } from '@beacon/shared';
import { CONTRACT_TYPES, WORK_LOCATIONS } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { Department } from '../departments/department.entity.js';
import { Role } from '../roles/role.entity.js';
import { Team } from '../teams/team.entity.js';
import { User } from '../users/user.entity.js';

/**
 * A pending account. The invitee has no password yet, so the emailed token is the
 * credential — and, exactly like a refresh token, only its SHA-256 digest is stored.
 *
 * The employment fields are held here rather than on a half-created `User`, so an
 * unaccepted invitation never appears in the people list or a permission check.
 */
@Entity({ tableName: 'invitations' })
@Index({ properties: ['email'] })
export class Invitation extends OrganizationScopedEntity {
  @Property({ type: 'string', length: 320 })
  email!: string;

  @Property({ type: 'string', length: 100 })
  firstName!: string;

  @Property({ type: 'string', length: 100 })
  lastName!: string;

  /** SHA-256 of the token handed to the inviter. Unique so a lookup is a single hit. */
  @Property({ type: 'string', length: 64, unique: true })
  tokenHash!: string;

  @Property({ type: 'timestamptz' })
  expiresAt!: Date;

  /** Set once, when the invitee sets a password. A spent invitation is never reusable. */
  @Property({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null = null;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  invitedBy: Ref<User> | null = null;

  @ManyToMany({ entity: () => Role, owner: true, pivotTable: 'invitation_roles' })
  roles = new Collection<Role>(this);

  @Property({ type: 'string', length: 120, nullable: true })
  jobTitle: string | null = null;

  @ManyToOne(() => Department, { ref: true, nullable: true, deleteRule: 'set null' })
  department: Ref<Department> | null = null;

  @ManyToOne(() => Team, { ref: true, nullable: true, deleteRule: 'set null' })
  team: Ref<Team> | null = null;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  manager: Ref<User> | null = null;

  @Enum({ items: () => CONTRACT_TYPES, type: 'string', nullable: true })
  contractType: ContractType | null = null;

  @Property({ type: 'string', length: 120, nullable: true })
  office: string | null = null;

  @Enum({ items: () => WORK_LOCATIONS, type: 'string', nullable: true })
  workLocation: WorkLocation | null = null;

  @Property({ type: 'string', length: 64, nullable: true })
  timezone: string | null = null;

  @Property({ type: 'string', length: 10, default: 'en' })
  locale: string = 'en';

  @Property({ type: 'date', nullable: true })
  startsOn: string | null = null;
}
