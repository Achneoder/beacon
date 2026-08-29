import { Entity, Index, Property, Unique } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * One row per authorization request, created by `POST /auth/sso/start` and consumed
 * by the callback. Single-use: a consumed or expired row is a hard refusal, which is
 * what stops a captured or replayed callback URL from starting a session twice.
 *
 * `stateHash` follows `RefreshToken.tokenHash` and the invitation token — stored only
 * as its SHA-256 digest, so a database read cannot hand out a working `state`. The PKCE
 * verifier is stored as-is: the token exchange has to send it, and on its own it is
 * worthless without the matching authorization code and a live row.
 */
@Entity({ tableName: 'sso_login_attempts' })
@Index({ properties: ['expiresAt'] })
export class SsoLoginAttempt extends OrganizationScopedEntity {
  @Unique()
  @Property({ type: 'string', length: 64 })
  stateHash!: string;

  @Property({ type: 'string', length: 255 })
  nonce!: string;

  @Property({ type: 'string', length: 255 })
  codeVerifier!: string;

  @Property({ type: 'timestamptz' })
  expiresAt!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null = null;

  @Property({ type: 'string', length: 255, nullable: true })
  userAgent: string | null = null;
}
