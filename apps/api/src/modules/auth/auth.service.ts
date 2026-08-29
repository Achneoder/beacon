import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EntityManager } from '@mikro-orm/postgresql';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthResponse, SessionUser, SetupState, SsoErrorCode } from '@beacon/shared';
import { OrganizationService } from '../organizations/organization.service.js';
import { lockAdvisory } from '../../common/db/advisory-lock.js';
import { SsoProvider } from '../sso/sso-provider.entity.js';
import { User, UserStatus } from '../users/user.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { PasswordService } from './password.service.js';
import { durationToSeconds } from './refresh-cookie.js';
import type { JwtPayload } from './jwt.strategy.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';

const DEFAULT_ACCESS_SECONDS = 15 * 60;
const DEFAULT_REFRESH_SECONDS = 30 * 24 * 60 * 60;

/** Namespace for the rotation lock — see {@link lockAdvisory}. */
const REFRESH_ROTATION_LOCK = 20_260_003;

/**
 * How long after a rotation a spent token is read as "a second tab of the same
 * browser" rather than "stolen" — see {@link AuthService.refresh}. Configurable so a
 * test can set it to zero and assert the family-revocation guarantee without sleeping
 * through the window.
 */
const REFRESH_REPLAY_GRACE_MS = 30_000;

export interface IssuedSession {
  auth: AuthResponse;
  refreshToken: string;
  refreshMaxAgeMs: number;
}

/** Refresh tokens are opaque; only this digest is ever persisted. */
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly em: EntityManager,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly organizations: OrganizationService,
  ) {}

  /**
   * First run only. `OrganizationService.createWithOwner` refuses once an organization
   * exists, so this endpoint installs the instance and then permanently 409s — Beacon
   * is deployed for one organization and everybody after the owner is invited.
   */
  async register(dto: RegisterDto, userAgent?: string): Promise<IssuedSession> {
    const passwordHash = await this.passwords.hash(dto.password);
    const { user } = await this.organizations.createWithOwner({ ...dto, passwordHash });

    await this.em.populate(user, ['roles', 'organization']);

    return this.issueSession(user, userAgent);
  }

  /** Whether the register screen still has anything to offer. */
  async setupState(): Promise<SetupState> {
    return { setupRequired: await this.organizations.isSetupRequired() };
  }

  /**
   * Email is unique per organization, and an installation holds exactly one, so an
   * address identifies at most one account.
   */
  async login(dto: LoginDto, userAgent?: string): Promise<IssuedSession> {
    const user = await this.em.findOne(
      User,
      { email: dto.email.toLowerCase() },
      { populate: ['roles', 'organization'] },
    );

    // Verify even when there is no account, so a missing address and a wrong password
    // are indistinguishable by timing.
    const matches = await this.passwords.verify(user?.passwordHash ?? null, dto.password);
    if (!user || !matches) throw new UnauthorizedException('invalid credentials');

    if (user.status !== UserStatus.Active) throw new UnauthorizedException('account is not active');

    await this.refuseIfSsoEnforced(user);

    user.lastLoginAt = new Date();
    await this.em.flush();

    return this.issueSession(user, userAgent);
  }

  /**
   * An admin can require SSO for everyone else while staying able to sign in with a
   * password themselves — a broken IdP must not be able to lock every administrator
   * out of an on-premise install whose only other door is a database edit. Checked
   * against the user's own permission union, never a role name, per the roadmap's
   * "check permissions, never role names" rule.
   *
   * Queried directly rather than through `SsoService`, which depends on `AuthModule`
   * for `startSessionFor` — injecting it back here would be a module cycle.
   */
  private async refuseIfSsoEnforced(user: User): Promise<void> {
    const provider = await this.em.findOne(SsoProvider, { organization: user.organization.id });
    if (!provider?.enabled || !provider.enforced) return;
    if (user.permissions.includes('organization:manage')) return;

    throw new ForbiddenException('sso_required' satisfies SsoErrorCode);
  }

  /**
   * Rotates: the presented token is spent, a fresh one takes its place. Presenting an
   * already-spent token means it leaked, so the whole family is revoked and the holder
   * — legitimate or not — has to sign in again.
   *
   * Rotation serializes on an advisory lock keyed by the token hash: two tabs of the
   * same browser share the cookie jar and can present the same token at once, and
   * without the lock both would pass the `revokedAt` check and mint two live
   * successors — replay detection defeated by a double refresh. The lock makes the
   * loser observe the winner's revocation, and the grace window tells a just-rotated
   * loser (a second tab) apart from a replayed, stolen token.
   *
   * The verdict is decided under the lock, but the refusal itself — the family
   * revocation, above all — happens outside the transaction: a 401 thrown inside it
   * would roll the revocation back with it.
   */
  async refresh(token: string | undefined, userAgent?: string): Promise<IssuedSession> {
    if (!token) throw new UnauthorizedException('missing refresh token');
    const tokenHash = digest(token);

    const verdict = await this.em.transactional(async (em) => {
      await lockAdvisory(em, REFRESH_ROTATION_LOCK, tokenHash);

      const existing = await em.findOne(RefreshToken, { tokenHash });
      if (!existing) return { decision: 'unknown' as const };

      if (existing.revokedAt) {
        return this.withinReplayGrace(existing.revokedAt)
          ? { decision: 'spent' as const }
          : { decision: 'revoke-family' as const, userId: existing.user.id };
      }
      if (existing.expiresAt.getTime() <= Date.now()) {
        return { decision: 'revoke-family' as const, userId: existing.user.id };
      }

      const user = await em.findOne(
        User,
        { id: existing.user.id },
        { populate: ['roles', 'organization'] },
      );
      if (!user || user.status !== UserStatus.Active) {
        return { decision: 'revoke-family' as const, userId: existing.user.id };
      }

      return {
        decision: 'rotate' as const,
        session: await this.issueSession(
          user,
          userAgent,
          (successorHash) => {
            existing.revokedAt = new Date();
            existing.replacedByHash = successorHash;
          },
          em,
        ),
      };
    });

    switch (verdict.decision) {
      case 'rotate':
        return verdict.session;
      case 'unknown':
        throw new UnauthorizedException('invalid refresh token');
      case 'spent':
        throw new UnauthorizedException('refresh token is no longer valid');
      case 'revoke-family':
        await this.revokeAllForUser(this.em, verdict.userId);
        throw new UnauthorizedException('refresh token is no longer valid');
    }
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;

    const existing = await this.em.findOne(RefreshToken, { tokenHash: digest(token) });
    if (!existing || existing.revokedAt) return;

    existing.revokedAt = new Date();
    await this.em.flush();
  }

  /**
   * Signs in a user the caller has just created — invitation acceptance, which has
   * already proved the invitee's identity through the token and needs the same session
   * registration hands back.
   */
  async startSessionFor(user: User, userAgent?: string): Promise<IssuedSession> {
    await this.em.populate(user, ['roles', 'organization']);

    return this.issueSession(user, userAgent);
  }

  /** Re-read from the database, so /auth/me reflects role changes before the token expires. */
  async currentUser(userId: string, organizationId: string): Promise<SessionUser> {
    const user = await this.em.findOne(
      User,
      { id: userId, organization: organizationId },
      { populate: ['roles', 'organization'] },
    );
    if (!user) throw new UnauthorizedException('user no longer exists');

    return toSessionUser(user);
  }

  private async revokeAllForUser(em: EntityManager, userId: string): Promise<void> {
    await em.nativeUpdate(RefreshToken, { user: userId, revokedAt: null }, { revokedAt: new Date() });
  }

  /** Whether `revokedAt` is recent enough to be a second tab, not a replay. */
  private withinReplayGrace(revokedAt: Date): boolean {
    const configured = this.config.get<string>('REFRESH_REPLAY_GRACE_MS');
    const graceMs = configured ? Number(configured) : REFRESH_REPLAY_GRACE_MS;

    return Date.now() - revokedAt.getTime() < graceMs;
  }

  private async issueSession(
    user: User,
    userAgent?: string,
    onIssued?: (successorHash: string) => void,
    /** Explicit when called inside `em.transactional` — the fork owns the writes. */
    em: EntityManager = this.em,
  ): Promise<IssuedSession> {
    const accessSeconds = durationToSeconds(
      this.config.get<string>('JWT_EXPIRES_IN') ?? '15m',
      DEFAULT_ACCESS_SECONDS,
    );
    const refreshSeconds = durationToSeconds(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d',
      DEFAULT_REFRESH_SECONDS,
    );

    const payload: JwtPayload = {
      sub: user.id,
      org: user.organization.id,
      email: user.email,
      permissions: user.permissions,
    };

    const accessToken = await this.jwt.signAsync(payload, { expiresIn: accessSeconds });

    const refreshToken = randomBytes(32).toString('base64url');
    const tokenHash = digest(refreshToken);

    em.create(RefreshToken, {
      organization: user.organization,
      user,
      tokenHash,
      expiresAt: new Date(Date.now() + refreshSeconds * 1000),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });

    onIssued?.(tokenHash);
    await em.flush();

    return {
      auth: { accessToken, expiresIn: accessSeconds, user: toSessionUser(user) },
      refreshToken,
      refreshMaxAgeMs: refreshSeconds * 1000,
    };
  }
}

/** Requires `roles` and `organization` to be populated. */
export function toSessionUser(user: User): SessionUser {
  const organization = user.organization.getEntity();

  return {
    id: user.id,
    organizationId: organization.id,
    email: user.email,
    permissions: user.permissions,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale,
    timezone: user.timezone,
    jobTitle: user.jobTitle,
    roleKeys: user.roles.getItems().map((role) => role.key),
    organizationName: organization.name,
    organizationSlug: organization.slug,
  };
}
