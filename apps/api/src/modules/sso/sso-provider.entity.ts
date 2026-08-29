import { Entity, Property, Unique } from '@mikro-orm/core';
import type { SsoProtocol } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * One row per organization — created the first time the settings screen is saved.
 * `@Unique` on `organization` is what makes "one provider per installation" a database
 * fact, not just a convention: Beacon is deployed for a single organization, so the
 * roadmap's per-organization routing collapses and there is nothing to pick between.
 *
 * The client secret is a bearer credential for the IdP, unlike `User.passwordHash` —
 * it has to be recoverable, so it is encrypted (`SecretCipher`, AES-256-GCM) rather
 * than hashed, and is never returned by any endpoint.
 */
@Entity({ tableName: 'sso_providers' })
@Unique({ properties: ['organization'] })
export class SsoProvider extends OrganizationScopedEntity {
  @Property({ type: 'string', length: 16, default: 'oidc' })
  protocol: SsoProtocol = 'oidc';

  /** The button label — "Sign in with Okta". */
  @Property({ type: 'string', length: 100 })
  displayName!: string;

  @Property({ type: 'string', length: 2048 })
  issuerUrl!: string;

  @Property({ type: 'string', length: 255 })
  clientId!: string;

  @Property({ type: 'text' })
  clientSecretCiphertext!: string;

  @Property({ type: 'string', length: 64 })
  clientSecretIv!: string;

  @Property({ type: 'string', length: 255, default: 'openid email profile' })
  scopes: string = 'openid email profile';

  @Property({ type: 'string', length: 100, default: 'email' })
  emailClaim: string = 'email';

  /** Empty means any domain may sign in through this provider. */
  @Property({ type: 'json' })
  allowedDomains: string[] = [];

  @Property({ type: 'boolean', default: false })
  enabled: boolean = false;

  /**
   * Refuses password login for everyone except `organization:manage` — checked
   * against the user's own permission union, never a role name, so a broken IdP
   * cannot lock every admin out of an on-premise install whose only other door is a
   * database edit.
   */
  @Property({ type: 'boolean', default: false })
  enforced: boolean = false;

  @Property({ type: 'timestamptz', nullable: true })
  lastTestedAt: Date | null = null;

  @Property({ type: 'text', nullable: true })
  lastTestError: string | null = null;
}
