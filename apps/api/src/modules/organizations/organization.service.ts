import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  DEFAULT_ROLES,
  type DefaultRole,
  type OrganizationSummary,
  type RoleSummary,
} from '@beacon/shared';
import { Organization } from './organization.entity.js';
import { Role } from '../roles/role.entity.js';
import { User, UserStatus } from '../users/user.entity.js';
import { slugify, uniqueSlug } from './slug.js';
import type { UpdateOrganizationDto } from './dto/update-organization.dto.js';

export interface CreateOrganizationInput {
  organizationName: string;
  slug?: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  locale?: string;
  timezone?: string;
}

/** The role every founder gets — it is the only one holding organization:manage. */
const OWNER_ROLE_KEY = 'owner';

/**
 * An arbitrary but fixed key for the Postgres advisory lock that serialises first-run
 * registration. Two requests arriving together on an empty database would otherwise
 * both pass the count below and install two organizations.
 */
const INSTALL_LOCK = 4_022_026_001;

@Injectable()
export class OrganizationService implements OnModuleInit {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(private readonly em: EntityManager) {}

  /**
   * A later phase can only add to `DEFAULT_ROLES` — it never has a route to reach
   * back and update a role an organization already has. Re-syncing every system
   * role's permissions from `DEFAULT_ROLES` on every boot means a new permission
   * (`document:write`, this phase's addition) reaches existing installs the moment
   * they restart, with no hand-written backfill per phase.
   *
   * Safe because nothing lets an organization edit a system role today — the day a
   * role editor changes that, this must stop overwriting what someone set by hand.
   */
  async onModuleInit(): Promise<void> {
    await this.reconcileSystemRoles();
  }

  private async reconcileSystemRoles(): Promise<void> {
    const roles = await this.em.find(Role, { isSystem: true });
    let changed = 0;

    for (const role of roles) {
      const defaults = DEFAULT_ROLES[role.key as DefaultRole] as readonly string[] | undefined;
      if (!defaults) continue;

      const current = [...role.permissions].sort();
      const next = [...defaults].sort();
      const same =
        current.length === next.length && current.every((permission, i) => permission === next[i]);
      if (same) continue;

      role.permissions = [...defaults] as Role['permissions'];
      changed += 1;
    }

    if (changed > 0) {
      await this.em.flush();
      this.logger.log(`reconciled permissions for ${changed} system role(s)`);
    }
  }

  /** Whether the instance is still unclaimed — the one thing registration is allowed on. */
  async isSetupRequired(): Promise<boolean> {
    return (await this.em.count(Organization, {})) === 0;
  }

  /**
   * Bootstraps the installation: the organization, its four built-in roles, and the
   * owner — all or nothing, because an organization without an owner is unreachable.
   *
   * Runs exactly once in the life of a deployment. Beacon is installed on-premise for
   * one organization; everybody else arrives by invitation.
   */
  async createWithOwner(input: CreateOrganizationInput): Promise<{ organization: Organization; user: User }> {
    return this.em.transactional(async (em) => {
      // Held until the transaction ends, so a second registration racing this one
      // waits here and then loses on the count.
      await em
        .getConnection()
        .execute('select pg_advisory_xact_lock(?)', [INSTALL_LOCK], 'run', em.getTransactionContext());

      if (await em.count(Organization, {})) {
        throw new ConflictException('this instance already has an organization');
      }

      const requested = input.slug ?? slugify(input.organizationName);

      if (input.slug && (await em.count(Organization, { slug: input.slug })) > 0) {
        throw new ConflictException('slug already taken');
      }

      const slug = await uniqueSlug(
        requested,
        async (candidate) => (await em.count(Organization, { slug: candidate })) > 0,
      );

      const organization = em.create(Organization, {
        name: input.organizationName,
        slug,
        defaultLocale: input.locale ?? 'en',
        timezone: input.timezone ?? 'UTC',
      });

      const roles = Object.entries(DEFAULT_ROLES).map(([key, permissions]) =>
        em.create(Role, {
          organization,
          key,
          name: key,
          permissions: [...permissions],
          isSystem: true,
        }),
      );

      const owner = em.create(User, {
        organization,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: UserStatus.Active,
        locale: input.locale ?? organization.defaultLocale,
      });

      const ownerRole = roles.find((role) => role.key === OWNER_ROLE_KEY);
      if (ownerRole) owner.roles.add(ownerRole);

      return { organization, user: owner };
    });
  }

  async findById(organizationId: string): Promise<Organization> {
    const organization = await this.em.findOne(Organization, { id: organizationId });
    if (!organization) throw new NotFoundException('organization not found');

    return organization;
  }

  async update(organizationId: string, changes: UpdateOrganizationDto): Promise<Organization> {
    const organization = await this.findById(organizationId);

    if (changes.name !== undefined) organization.name = changes.name;
    if (changes.defaultLocale !== undefined) organization.defaultLocale = changes.defaultLocale;
    if (changes.timezone !== undefined) organization.timezone = changes.timezone;

    await this.em.flush();

    return organization;
  }

  /** Always scoped by organization — there is no cross-tenant role listing. */
  async listRoles(organizationId: string): Promise<RoleSummary[]> {
    const roles = await this.em.find(
      Role,
      { organization: organizationId },
      { orderBy: { key: 'asc' } },
    );

    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.permissions,
      isSystem: role.isSystem,
    }));
  }
}

export function toOrganizationSummary(organization: Organization): OrganizationSummary {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    defaultLocale: organization.defaultLocale,
    timezone: organization.timezone,
  };
}
