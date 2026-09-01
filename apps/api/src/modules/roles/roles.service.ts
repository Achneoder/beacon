import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  isOwnerRole,
  type CreateRoleRequest,
  type Permission,
  type RoleSummary,
  type UpdateRoleRequest,
} from '@beacon/shared';
import { assertGrantable, assertRoleEditable } from '../../common/auth/role-grant.js';
import { lockAdvisory } from '../../common/db/advisory-lock.js';
import { Organization } from '../organizations/organization.entity.js';
import { Invitation } from '../invitations/invitation.entity.js';
import { User } from '../users/user.entity.js';
import { slugify, uniqueSlug } from '../organizations/slug.js';
import { Role } from './role.entity.js';

/** Namespace for the create lock — see {@link lockAdvisory}. */
const ROLE_CREATE_LOCK = 20_260_007;

/** `roles.key` is varchar(64); the suffix `uniqueSlug` may append needs room. */
const KEY_LENGTH = 60;

@Injectable()
export class RolesService {
  constructor(private readonly em: EntityManager) {}

  /** Always scoped by organization — there is no cross-tenant role listing. */
  async list(organizationId: string): Promise<RoleSummary[]> {
    const roles = await this.em.find(
      Role,
      { organization: organizationId },
      { orderBy: { key: 'asc' } },
    );

    const counts = await this.memberCounts(organizationId);

    return roles.map((role) => toRoleSummary(role, counts.get(role.id) ?? 0));
  }

  /**
   * Defining a role is a grant — the permissions named become assignable, and the
   * author may hold the role themselves — so it runs the same `assertGrantable` an
   * assignment does. Without it `organization:manage` would be a route to every other
   * permission in the system: package what you lack, then wear it.
   */
  async create(
    organizationId: string,
    dto: CreateRoleRequest,
    granter: readonly Permission[],
  ): Promise<RoleSummary> {
    const permissions = unique(dto.permissions);
    assertGrantable(granter, [{ name: dto.name, permissions }]);

    const role = await this.em.transactional(async (em) => {
      // Name and key are both checked and then written, with no row yet to lock.
      await lockAdvisory(em, ROLE_CREATE_LOCK, organizationId);

      if (await em.count(Role, { organization: organizationId, name: dto.name })) {
        throw new ConflictException('a role with that name already exists');
      }

      // The key is derived once and never moves again: the web looks up built-in copy
      // by it, and a rename that changed it would silently orphan a translation.
      const key = await uniqueSlug(
        slugify(dto.name).slice(0, KEY_LENGTH) || 'role',
        async (candidate) => (await em.count(Role, { organization: organizationId, key: candidate })) > 0,
      );

      return em.create(Role, {
        organization: em.getReference(Organization, organizationId, { wrapped: true }),
        key,
        name: dto.name,
        permissions,
        isSystem: false,
      });
    });

    return toRoleSummary(role, 0);
  }

  /**
   * A built-in role accepts only a new permission list. Its name is not the
   * organization's to change: the web renders built-in roles from `roles.<key>` copy in
   * both locales, so a rename would show up nowhere, and its key — derived from the
   * original name — has to stay put for that lookup to work.
   */
  async update(
    organizationId: string,
    id: string,
    dto: UpdateRoleRequest,
    editor: readonly Permission[],
  ): Promise<RoleSummary> {
    const role = await this.findEntity(organizationId, id);
    this.assertMutable(role, editor);

    if (dto.name !== undefined && dto.name !== role.name) {
      if (role.isSystem) {
        throw new ForbiddenException('a built-in role cannot be renamed');
      }
      if (await this.em.count(Role, { organization: organizationId, name: dto.name })) {
        throw new ConflictException('a role with that name already exists');
      }
      role.name = dto.name;
    }

    if (dto.permissions !== undefined) {
      const permissions = unique(dto.permissions);
      assertGrantable(editor, [{ name: role.name, permissions }]);

      if (role.isSystem && !sameSet(role.permissions, permissions)) {
        // From here on this role is the organization's, not the shipped definition —
        // `reconcileSystemRoles` must stop rewriting it at every boot.
        role.customized = true;
      }
      role.permissions = permissions;
    }

    await this.em.flush();

    const counts = await this.memberCounts(organizationId);

    return toRoleSummary(role, counts.get(role.id) ?? 0);
  }

  /**
   * Refused while anyone still holds the role, rather than quietly stripping it from
   * them: `user_roles` cascades, so the delete would succeed and take an unknown number
   * of people's authority with it, invisibly. Pending invitations count too — they
   * carry roles that have not been claimed yet.
   */
  async remove(organizationId: string, id: string, editor: readonly Permission[]): Promise<void> {
    const role = await this.findEntity(organizationId, id);
    if (role.isSystem) {
      throw new ForbiddenException('a built-in role cannot be deleted');
    }
    assertRoleEditable(editor, role);

    await this.em.transactional(async (em) => {
      const holders = await em.count(User, { organization: organizationId, roles: id });
      const pending = await em.count(Invitation, {
        organization: organizationId,
        roles: id,
        acceptedAt: null,
      });

      if (holders + pending > 0) {
        throw new ConflictException('this role is still assigned; reassign those people first');
      }

      // In one transaction so the count is not stale by the time the delete lands: an
      // assignment racing this holds a key-share lock on the row the delete must take
      // exclusively, so the two serialize rather than overlapping.
      await em.removeAndFlush(role);
    });
  }

  /**
   * The two rules an edit has to clear before anything is read off the body: the owner
   * role is not editable at all, and no role may be rewritten by someone with less
   * authority than the role already carries.
   */
  private assertMutable(role: Role, editor: readonly Permission[]): void {
    if (isOwnerRole(role)) {
      throw new ForbiddenException('the owner role always holds every permission');
    }
    assertRoleEditable(editor, role);
  }

  private async findEntity(organizationId: string, id: string): Promise<Role> {
    const role = await this.em.findOne(Role, { id, organization: organizationId });
    if (!role) throw new NotFoundException('role not found');

    return role;
  }

  /**
   * One grouped query rather than one per role. `user_roles` is a pivot and carries no
   * organization of its own, so the scope comes from the join to `users` — the same
   * reason the e2e teardown had to learn to delete through a subquery.
   *
   * Pending invitations are counted alongside people: a role held only by an unaccepted
   * invitation is still in use, and `remove` refuses on exactly this number.
   */
  private async memberCounts(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.em.getConnection().execute<{ role_id: string; count: string }[]>(
      `select "role_id", sum("count") as "count" from (
         select "ur"."role_id" as "role_id", count(*) as "count"
           from "user_roles" "ur"
           join "users" "u" on "u"."id" = "ur"."user_id"
          where "u"."organization_id" = ?
          group by "ur"."role_id"
         union all
         select "ir"."role_id" as "role_id", count(*) as "count"
           from "invitation_roles" "ir"
           join "invitations" "i" on "i"."id" = "ir"."invitation_id"
          where "i"."organization_id" = ? and "i"."accepted_at" is null
          group by "ir"."role_id"
       ) "held" group by "role_id"`,
      [organizationId, organizationId],
    );

    return new Map(rows.map((row) => [row.role_id, Number(row.count)]));
  }
}

export function toRoleSummary(role: Role, memberCount: number): RoleSummary {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    permissions: role.permissions,
    isSystem: role.isSystem,
    customized: role.customized,
    memberCount,
  };
}

/** A duplicate in the body is a client slip, not a conflict — collapse it and move on. */
function unique(permissions: readonly Permission[]): Permission[] {
  return [...new Set(permissions)];
}

function sameSet(left: readonly Permission[], right: readonly Permission[]): boolean {
  const held = new Set(left);

  return held.size === right.length && right.every((permission) => held.has(permission));
}
