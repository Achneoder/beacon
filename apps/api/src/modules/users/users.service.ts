import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { type Ref, ref } from '@mikro-orm/core';
import {
  fullName,
  type EmploymentFields,
  type Permission,
  type UserDetail,
  type UserSummary,
} from '@beacon/shared';
import { assertGrantable } from '../../common/auth/role-grant.js';
import { Department } from '../departments/department.entity.js';
import { Organization } from '../organizations/organization.entity.js';
import { Role } from '../roles/role.entity.js';
import { Team } from '../teams/team.entity.js';
import { User, UserStatus } from './user.entity.js';
import { nextEmployeeNumber } from './employee-number.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

/** Populated for the detail shape; the list needs only the two lookups. */
const DETAIL_POPULATE = ['roles', 'department', 'team', 'manager'] as const;
const SUMMARY_POPULATE = ['department', 'team'] as const;

/** The role a new user gets when the caller names none. */
const DEFAULT_ROLE_KEY = 'employee';

export interface ListUsersFilter {
  departmentId?: string;
  teamId?: string;
  status?: UserStatus;
  /** Substring over name and email, for the people list's search box. */
  search?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly em: EntityManager) {}

  async list(organizationId: string, filter: ListUsersFilter = {}): Promise<UserSummary[]> {
    const where: Record<string, unknown> = { organization: organizationId };

    if (filter.departmentId) where.department = filter.departmentId;
    if (filter.teamId) where.team = filter.teamId;
    if (filter.status) where.status = filter.status;
    if (filter.search) {
      const like = `%${filter.search.trim()}%`;
      where.$or = [
        { firstName: { $ilike: like } },
        { lastName: { $ilike: like } },
        { email: { $ilike: like } },
      ];
    }

    const users = await this.em.find(User, where, {
      populate: [...SUMMARY_POPULATE],
      orderBy: { lastName: 'asc', firstName: 'asc' },
    });

    return users.map(toUserSummary);
  }

  async findDetail(organizationId: string, userId: string): Promise<UserDetail> {
    return toUserDetail(await this.findEntity(organizationId, userId));
  }

  /**
   * Several users by id, scoped by organization — search's post-filter, which turns
   * a set of index hits back into rows. Missing ids are simply absent rather than an
   * error: an id the caller cannot reach is a result that disappears, not a 404.
   */
  async findByIds(organizationId: string, ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];

    return this.em.find(User, { id: { $in: ids }, organization: organizationId });
  }

  /**
   * Every query is scoped by organization, so an id from another tenant reads as a
   * missing user rather than leaking that it exists.
   */
  async findEntity(organizationId: string, userId: string): Promise<User> {
    const user = await this.em.findOne(
      User,
      { id: userId, organization: organizationId },
      { populate: [...DETAIL_POPULATE] },
    );
    if (!user) throw new NotFoundException('user not found');

    return user;
  }

  /**
   * Transactional because the employee number is allocated under a lock that lives and
   * dies with the transaction — see `nextEmployeeNumber`. `begin` on this `em` rather
   * than `em.transactional`, so the helpers below keep working against the same one.
   */
  async create(
    organizationId: string,
    dto: CreateUserDto,
    granter: readonly Permission[],
  ): Promise<UserDetail> {
    const email = dto.email.toLowerCase();

    await this.em.begin();
    let userId: string;
    try {
      if (await this.em.count(User, { organization: organizationId, email })) {
        throw new ConflictException('a user with that email already exists');
      }

      const user = this.em.create(User, {
        organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        locale: dto.locale ?? 'en',
        // Created without a password: the account is reachable only once someone sets
        // one, which is what an invitation is for.
        status: UserStatus.Invited,
        employeeNumber: dto.employeeNumber ?? (await nextEmployeeNumber(this.em, organizationId)),
      });

      await this.applyEmployment(organizationId, user, dto);
      user.roles.set(await this.resolveRoles(organizationId, dto.roleIds, { granter }));

      await this.em.flush();
      await this.em.commit();
      userId = user.id;
    } catch (error) {
      await this.em.rollback();
      throw error;
    }

    return this.findDetail(organizationId, userId);
  }

  async update(organizationId: string, userId: string, dto: UpdateUserDto): Promise<UserDetail> {
    const user = await this.findEntity(organizationId, userId);

    // The shared union and the entity enum carry the same values; the cast is the
    // seam between the wire contract and the ORM's own type.
    if (dto.status !== undefined) user.status = dto.status as UserStatus;
    await this.applyEmployment(organizationId, user, dto);

    await this.em.flush();

    return this.findDetail(organizationId, user.id);
  }

  /** What a person may change about themselves — never their own employment. */
  async updateOwnProfile(
    organizationId: string,
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserDetail> {
    const user = await this.findEntity(organizationId, userId);

    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.locale !== undefined) user.locale = dto.locale;
    if (dto.timezone !== undefined) user.timezone = dto.timezone;

    await this.em.flush();

    return toUserDetail(user);
  }

  async setRoles(
    organizationId: string,
    userId: string,
    roleIds: string[],
    granter: readonly Permission[],
  ): Promise<UserDetail> {
    const user = await this.findEntity(organizationId, userId);
    user.roles.set(
      await this.resolveRoles(organizationId, roleIds, { allowEmpty: false, granter }),
    );

    await this.em.flush();

    return toUserDetail(user);
  }

  /**
   * Soft delete, always. A hard delete would orphan attendance, absence and document
   * history — the decision recorded in the roadmap for phase 1.
   */
  async disable(organizationId: string, userId: string, actingUserId: string): Promise<UserDetail> {
    if (userId === actingUserId) throw new BadRequestException('you cannot disable your own account');

    const user = await this.findEntity(organizationId, userId);
    user.status = UserStatus.Disabled;

    await this.em.flush();

    return toUserDetail(user);
  }

  /**
   * The people whose requests this user approves — direct reports only. Phases 2 and 3
   * both ask "the people I approve for", so the edge is read in exactly one place.
   */
  async subordinateIdsOf(organizationId: string, managerId: string): Promise<string[]> {
    const reports = await this.em.find(
      User,
      { organization: organizationId, manager: managerId },
      { fields: ['id'] },
    );

    return reports.map((report) => report.id);
  }

  /** Shared by create and update, so the two cannot interpret a field differently. */
  private async applyEmployment(
    organizationId: string,
    user: User,
    fields: EmploymentFields,
  ): Promise<void> {
    if (fields.employeeNumber !== undefined) user.employeeNumber = fields.employeeNumber;
    if (fields.jobTitle !== undefined) user.jobTitle = fields.jobTitle;
    if (fields.contractType !== undefined) user.contractType = fields.contractType;
    if (fields.office !== undefined) user.office = fields.office;
    if (fields.workLocation !== undefined) user.workLocation = fields.workLocation;
    if (fields.phone !== undefined) user.phone = fields.phone;
    if (fields.timezone !== undefined) user.timezone = fields.timezone;
    if (fields.locale !== undefined) user.locale = fields.locale;
    if (fields.startsOn !== undefined) user.startsOn = fields.startsOn;
    if (fields.endsOn !== undefined) user.endsOn = fields.endsOn;

    if (fields.departmentId !== undefined) {
      user.department = await this.scopedRef(Department, organizationId, fields.departmentId);
    }
    if (fields.teamId !== undefined) {
      user.team = await this.scopedRef(Team, organizationId, fields.teamId);
    }
    if (fields.managerId !== undefined) {
      if (fields.managerId === user.id) {
        throw new BadRequestException('a user cannot be their own manager');
      }
      user.manager = await this.scopedRef(User, organizationId, fields.managerId);
      if (user.manager) await this.assertNoManagerCycle(organizationId, user);
    }
  }

  /**
   * Resolving a reference through a scoped lookup — rather than `getReference` — is
   * what keeps a client from attaching this user to another tenant's department.
   */
  private async scopedRef<T extends { id: string }>(
    entity: { new (...args: never[]): T },
    organizationId: string,
    id: string | null,
  ): Promise<Ref<T> | null> {
    if (id === null) return null;

    const found = await this.em.findOne(entity, { id, organization: organizationId } as never);
    if (!found) throw new BadRequestException('referenced record does not exist');

    return ref(found) as Ref<T>;
  }

  /**
   * Walking up from the new manager must not arrive back at this user. Without the
   * check, "A reports to B, B reports to A" would make every approver lookup loop.
   */
  private async assertNoManagerCycle(organizationId: string, user: User): Promise<void> {
    const seen = new Set<string>([user.id]);
    let current = user.manager?.id ?? null;

    while (current) {
      if (seen.has(current)) throw new BadRequestException('that would create a management cycle');
      seen.add(current);

      const next = await this.em.findOne(
        User,
        { id: current, organization: organizationId },
        { fields: ['manager'] },
      );
      current = next?.manager?.id ?? null;
    }
  }

  /**
   * Roles are per organization, so an id from elsewhere is simply not found.
   *
   * `granter` is the caller's own permission union, checked by `assertGrantable` — a
   * caller may not hand out authority they do not hold. The default `employee` role
   * gets the same check as an explicitly named one: it is resolved by key rather than
   * chosen by the client, but it is still a grant, and the day somebody edits what
   * `employee` means is the day the two paths must not disagree.
   */
  private async resolveRoles(
    organizationId: string,
    roleIds: string[] | undefined,
    options: { allowEmpty?: boolean; granter: readonly Permission[] },
  ): Promise<Role[]> {
    if (roleIds === undefined) {
      const fallback = await this.em.findOne(Role, {
        organization: organizationId,
        key: DEFAULT_ROLE_KEY,
      });
      const roles = fallback ? [fallback] : [];
      assertGrantable(options.granter, roles);

      return roles;
    }

    if (roleIds.length === 0 && options.allowEmpty === false) {
      throw new BadRequestException('a user needs at least one role');
    }

    const roles = await this.em.find(Role, { organization: organizationId, id: { $in: roleIds } });
    if (roles.length !== new Set(roleIds).size) {
      throw new BadRequestException('one or more roles do not exist');
    }
    assertGrantable(options.granter, roles);

    return roles;
  }
}

/** Requires `department` and `team` to be populated. */
export function toUserSummary(user: User): UserSummary {
  const department = user.department?.getEntity() ?? null;
  const team = user.team?.getEntity() ?? null;

  return {
    id: user.id,
    employeeNumber: user.employeeNumber,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    jobTitle: user.jobTitle,
    status: user.status,
    departmentId: department?.id ?? null,
    departmentName: department?.name ?? null,
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
  };
}

/** Requires `roles`, `department`, `team` and `manager` to be populated. */
export function toUserDetail(user: User): UserDetail {
  const manager = user.manager?.getEntity() ?? null;

  return {
    ...toUserSummary(user),
    locale: user.locale,
    timezone: user.timezone,
    phone: user.phone,
    contractType: user.contractType,
    office: user.office,
    workLocation: user.workLocation,
    startsOn: user.startsOn,
    endsOn: user.endsOn,
    managerId: manager?.id ?? null,
    managerName: manager ? fullName(manager) : null,
    managerJobTitle: manager?.jobTitle ?? null,
    roles: user.roles.getItems().map((role) => ({ id: role.id, key: role.key, name: role.name })),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
