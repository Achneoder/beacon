import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref, type Ref } from '@mikro-orm/core';
import {
  fullName,
  type CreatedInvitation,
  type InvitationSummary,
} from '@beacon/shared';
import { Department } from '../departments/department.entity.js';
import { Organization } from '../organizations/organization.entity.js';
import { Role } from '../roles/role.entity.js';
import { Team } from '../teams/team.entity.js';
import { User, UserStatus } from '../users/user.entity.js';
import { nextEmployeeNumber } from '../users/employee-number.js';
import { PasswordService } from '../auth/password.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { invitationEmail } from './invitation-email.js';
import { Invitation } from './invitation.entity.js';
import {
  acceptUrl,
  createInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  isAcceptable,
} from './invitation-token.js';
import type { CreateInvitationDto } from './dto/create-invitation.dto.js';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto.js';

const DEFAULT_ROLE_KEY = 'employee';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  async list(organizationId: string): Promise<InvitationSummary[]> {
    const invitations = await this.em.find(
      Invitation,
      { organization: organizationId },
      { populate: ['roles', 'invitedBy'], orderBy: { createdAt: 'desc' } },
    );

    return invitations.map((invitation) => toInvitationSummary(invitation));
  }

  /**
   * The token is generated here and returned exactly once — only its digest is stored,
   * so nobody, including an administrator reading the table, can recover it later. It
   * is emailed to the invitee and handed back to the caller, who can pass the link on
   * by hand when there is no relay configured or the send failed.
   */
  async create(
    organizationId: string,
    invitedById: string,
    dto: CreateInvitationDto,
  ): Promise<CreatedInvitation> {
    const email = dto.email.toLowerCase();

    if (await this.em.count(User, { organization: organizationId, email })) {
      throw new ConflictException('a user with that email already exists');
    }

    const pending = await this.em.find(Invitation, {
      organization: organizationId,
      email,
      acceptedAt: null,
    });
    // Re-inviting is normal — the earlier link is simply retired, so only the newest
    // one works and a stale email cannot create a second account.
    for (const stale of pending) this.em.remove(stale);

    const token = createInvitationToken();
    const invitation = this.em.create(Invitation, {
      organization: this.em.getReference(Organization, organizationId),
      email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      tokenHash: hashInvitationToken(token),
      expiresAt: invitationExpiry(),
      invitedBy: this.em.getReference(User, invitedById, { wrapped: true }),
      jobTitle: dto.jobTitle ?? null,
      department: await this.scopedRef(Department, organizationId, dto.departmentId ?? null),
      team: await this.scopedRef(Team, organizationId, dto.teamId ?? null),
      manager: await this.scopedRef(User, organizationId, dto.managerId ?? null),
      contractType: dto.contractType ?? null,
      office: dto.office ?? null,
      workLocation: dto.workLocation ?? null,
      timezone: dto.timezone ?? null,
      locale: dto.locale ?? 'en',
      startsOn: dto.startsOn ?? null,
    });

    invitation.roles.set(await this.resolveRoles(organizationId, dto.roleIds));
    await this.em.flush();
    await this.em.populate(invitation, ['roles', 'invitedBy', 'organization']);

    const summary = toInvitationSummary(invitation);
    const url = acceptUrl(this.webBaseUrl(), token);
    // After the flush, and never inside it: a relay that is slow or down must not roll
    // back an invitation that is already valid. `send` reports delivery, it never throws.
    const emailSent = await this.mail.send(
      invitationEmail({
        email: invitation.email,
        firstName: invitation.firstName,
        organizationName: invitation.organization.getEntity().name,
        invitedByName: summary.invitedByName,
        acceptUrl: url,
        locale: invitation.locale,
      }),
    );

    return { ...summary, token, acceptUrl: url, emailSent };
  }

  async revoke(organizationId: string, id: string): Promise<void> {
    const invitation = await this.em.findOne(Invitation, { id, organization: organizationId });
    if (!invitation) throw new NotFoundException('invitation not found');

    await this.em.removeAndFlush(invitation);
  }

  /**
   * Public: the token *is* the credential, so the request names neither an
   * organization nor a user and the digest resolves both. Mirrors
   * `AuthService.register` — one transaction, and the account only exists if every
   * part of it does.
   */
  async accept(dto: AcceptInvitationDto): Promise<User> {
    const passwordHash = await this.passwords.hash(dto.password);

    return this.em.transactional(async (em) => {
      const invitation = await em.findOne(
        Invitation,
        { tokenHash: hashInvitationToken(dto.token) },
        { populate: ['roles', 'organization'] },
      );
      // One message for every failure mode: a wrong, spent or expired token must not
      // be distinguishable to whoever is holding it.
      if (!invitation || !isAcceptable(invitation)) {
        throw new BadRequestException('this invitation is no longer valid');
      }

      const organizationId = invitation.organization.id;

      if (await em.count(User, { organization: organizationId, email: invitation.email })) {
        throw new ConflictException('a user with that email already exists');
      }

      const user = em.create(User, {
        organization: invitation.organization,
        email: invitation.email,
        passwordHash,
        firstName: invitation.firstName,
        lastName: invitation.lastName,
        status: UserStatus.Active,
        locale: invitation.locale,
        timezone: invitation.timezone,
        employeeNumber: await nextEmployeeNumber(em, organizationId),
        jobTitle: invitation.jobTitle,
        department: invitation.department,
        team: invitation.team,
        manager: invitation.manager,
        contractType: invitation.contractType,
        office: invitation.office,
        workLocation: invitation.workLocation,
        startsOn: invitation.startsOn,
      });

      user.roles.set(invitation.roles.getItems());
      invitation.acceptedAt = new Date();

      return user;
    });
  }

  private webBaseUrl(): string {
    // The invite link is followed in a browser, so it points at the SPA. CORS_ORIGIN
    // already names it; there is no second URL to configure.
    return this.config.get<string>('WEB_BASE_URL') ?? this.config.get<string>('CORS_ORIGIN') ?? 'http://localhost:5173';
  }

  private async scopedRef<T extends { id: string }>(
    entity: { new (...args: never[]): T },
    organizationId: string,
    id: string | null,
  ): Promise<Ref<T> | null> {
    if (!id) return null;

    const found = await this.em.findOne(entity, { id, organization: organizationId } as never);
    if (!found) throw new BadRequestException('referenced record does not exist');

    return ref(found) as Ref<T>;
  }

  private async resolveRoles(organizationId: string, roleIds?: string[]): Promise<Role[]> {
    if (!roleIds) {
      const fallback = await this.em.findOne(Role, {
        organization: organizationId,
        key: DEFAULT_ROLE_KEY,
      });

      return fallback ? [fallback] : [];
    }

    const roles = await this.em.find(Role, { organization: organizationId, id: { $in: roleIds } });
    if (roles.length !== new Set(roleIds).size) {
      throw new BadRequestException('one or more roles do not exist');
    }

    return roles;
  }
}

/** Requires `roles` and `invitedBy` to be populated. */
export function toInvitationSummary(invitation: Invitation): InvitationSummary {
  const invitedBy = invitation.invitedBy?.getEntity() ?? null;

  return {
    id: invitation.id,
    email: invitation.email,
    firstName: invitation.firstName,
    lastName: invitation.lastName,
    roles: invitation.roles
      .getItems()
      .map((role) => ({ id: role.id, key: role.key, name: role.name })),
    invitedByName: invitedBy ? fullName(invitedBy) : null,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    isExpired: !isAcceptable(invitation),
  };
}

