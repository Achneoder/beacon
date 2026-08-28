import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EntityManager } from '@mikro-orm/postgresql';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthResponse, SessionUser } from '@beacon/shared';
import { OrganizationService } from '../organizations/organization.service.js';
import { User, UserStatus } from '../users/user.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { PasswordService } from './password.service.js';
import { durationToSeconds } from './refresh-cookie.js';
import type { JwtPayload } from './jwt.strategy.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';

const DEFAULT_ACCESS_SECONDS = 15 * 60;
const DEFAULT_REFRESH_SECONDS = 30 * 24 * 60 * 60;

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

  async register(dto: RegisterDto, userAgent?: string): Promise<IssuedSession> {
    if ((this.config.get<string>('AUTH_ALLOW_SIGNUP') ?? 'true') !== 'true') {
      throw new ForbiddenException('signup is disabled');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const { user } = await this.organizations.createWithOwner({ ...dto, passwordHash });

    await this.em.populate(user, ['roles', 'organization']);

    return this.issueSession(user, userAgent);
  }

  /**
   * Email is unique per organization, not globally, so one address may exist in several
   * tenants. Rather than asking which organization up front, the password decides: the
   * account whose hash matches wins. Candidates are checked newest-first.
   */
  async login(dto: LoginDto, userAgent?: string): Promise<IssuedSession> {
    const email = dto.email.toLowerCase();
    const candidates = await this.em.find(
      User,
      { email },
      { populate: ['roles', 'organization'], orderBy: { createdAt: 'desc' } },
    );

    let user: User | null = null;
    for (const candidate of candidates) {
      if (await this.passwords.verify(candidate.passwordHash, dto.password)) {
        user = candidate;
        break;
      }
    }

    // No candidate matched: still pay for one verification, so a missing account and a
    // wrong password are indistinguishable by timing.
    if (!user) {
      await this.passwords.verify(null, dto.password);
      throw new UnauthorizedException('invalid credentials');
    }

    if (user.status !== UserStatus.Active) throw new UnauthorizedException('account is not active');

    user.lastLoginAt = new Date();
    await this.em.flush();

    return this.issueSession(user, userAgent);
  }

  /**
   * Rotates: the presented token is spent, a fresh one takes its place. Presenting an
   * already-spent token means it leaked, so the whole family is revoked and the holder
   * — legitimate or not — has to sign in again.
   */
  async refresh(token: string | undefined, userAgent?: string): Promise<IssuedSession> {
    if (!token) throw new UnauthorizedException('missing refresh token');

    const existing = await this.em.findOne(RefreshToken, { tokenHash: digest(token) });
    if (!existing) throw new UnauthorizedException('invalid refresh token');

    if (existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
      await this.revokeAllForUser(existing.user.id);
      throw new UnauthorizedException('refresh token is no longer valid');
    }

    const user = await this.em.findOne(
      User,
      { id: existing.user.id },
      { populate: ['roles', 'organization'] },
    );
    if (!user || user.status !== UserStatus.Active) {
      await this.revokeAllForUser(existing.user.id);
      throw new UnauthorizedException('account is not active');
    }

    return this.issueSession(user, userAgent, (successorHash) => {
      existing.revokedAt = new Date();
      existing.replacedByHash = successorHash;
    });
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

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.em.nativeUpdate(RefreshToken, { user: userId, revokedAt: null }, { revokedAt: new Date() });
  }

  private async issueSession(
    user: User,
    userAgent?: string,
    onIssued?: (successorHash: string) => void,
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

    this.em.create(RefreshToken, {
      organization: user.organization,
      user,
      tokenHash,
      expiresAt: new Date(Date.now() + refreshSeconds * 1000),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });

    onIssued?.(tokenHash);
    await this.em.flush();

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
