import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';
import type * as client from 'openid-client';
import type {
  SsoErrorCode,
  SsoPublicState,
  SsoSettings,
  SsoTestResult,
} from '@beacon/shared';
import { Organization } from '../organizations/organization.entity.js';
import { OrganizationService } from '../organizations/organization.service.js';
import { User, UserStatus } from '../users/user.entity.js';
import { AuthService, type IssuedSession } from '../auth/auth.service.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { SecretCipher, type EncryptedSecret } from '../../common/crypto/secret-cipher.js';
import { OidcClient, type OidcProviderConfig } from './oidc-client.js';
import { SsoProvider } from './sso-provider.entity.js';
import { SsoLoginAttempt } from './sso-login-attempt.entity.js';
import type { UpdateSsoSettingsDto } from './dto/update-sso-settings.dto.js';
import type { TestSsoSettingsDto } from './dto/test-sso-settings.dto.js';

/** Long enough for a slow IdP redirect, short enough that a stale row is not a real window. */
const ATTEMPT_TTL_MS = 10 * 60 * 1000;

/** Follows `RefreshToken.tokenHash` and the invitation token: `state` is only ever stored hashed. */
function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export type SsoLoginOutcome = { session: IssuedSession } | { errorCode: SsoErrorCode };

@Injectable()
export class SsoService {
  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
    private readonly cipher: SecretCipher,
    private readonly oidc: OidcClient,
    private readonly organizations: OrganizationService,
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
  ) {}

  /** What the login screen needs before anyone has signed in — never the secret, never who is enforced for. */
  async publicState(): Promise<SsoPublicState> {
    const provider = await this.currentProvider();
    if (!provider?.enabled) return { enabled: false, displayName: null, enforced: false };

    return { enabled: true, displayName: provider.displayName, enforced: provider.enforced };
  }

  async getSettings(organizationId: string): Promise<SsoSettings> {
    const provider = await this.em.findOne(SsoProvider, { organization: organizationId });
    if (!provider) throw new NotFoundException('no sso provider is configured');

    return this.toSettings(provider);
  }

  /**
   * Upserts the one provider row. A discovery fetch runs against the submitted values
   * on every save — that is what lets `enabled: true` be refused "unless a discovery
   * fetch has succeeded" without a separate stored flag to keep in sync: the fetch and
   * the save happen in the same request. A failed fetch still saves the row with
   * `enabled: false`, so an admin mid-setup does not lose what they typed.
   */
  async updateSettings(organizationId: string, dto: UpdateSsoSettingsDto): Promise<SsoSettings> {
    this.requireCipher();

    if (dto.enforced && !dto.enabled) {
      throw new BadRequestException('enforcing sso requires it to be enabled');
    }

    let provider = await this.em.findOne(SsoProvider, { organization: organizationId });
    const clientSecret = dto.clientSecret ?? (provider ? this.decryptSecret(provider) : undefined);

    // Covers "enforcing sso requires a client secret" too: enforced can only be true
    // once enabled is (checked above), and enabled can only be true once a secret
    // exists — new or already stored — to get this far at all.
    if (!clientSecret) {
      throw new BadRequestException(
        'a client secret is required the first time a provider is configured',
      );
    }

    const discovered = await this.tryDiscover({
      issuerUrl: dto.issuerUrl,
      clientId: dto.clientId,
      clientSecret,
    });

    if (dto.enabled && !discovered.ok) {
      throw new BadRequestException(`the issuer could not be verified: ${discovered.error}`);
    }

    const secret: EncryptedSecret = dto.clientSecret
      ? this.cipher.encrypt(dto.clientSecret)
      : { ciphertext: provider!.clientSecretCiphertext, iv: provider!.clientSecretIv };

    if (!provider) {
      provider = this.em.create(SsoProvider, {
        organization: this.em.getReference(Organization, organizationId),
        protocol: 'oidc',
        displayName: dto.displayName,
        issuerUrl: dto.issuerUrl,
        clientId: dto.clientId,
        clientSecretCiphertext: secret.ciphertext,
        clientSecretIv: secret.iv,
        scopes: dto.scopes ?? 'openid email profile',
        emailClaim: dto.emailClaim ?? 'email',
        allowedDomains: dto.allowedDomains ?? [],
        enabled: dto.enabled,
        enforced: dto.enforced,
      });
    } else {
      provider.displayName = dto.displayName;
      provider.issuerUrl = dto.issuerUrl;
      provider.clientId = dto.clientId;
      provider.clientSecretCiphertext = secret.ciphertext;
      provider.clientSecretIv = secret.iv;
      if (dto.scopes !== undefined) provider.scopes = dto.scopes;
      if (dto.emailClaim !== undefined) provider.emailClaim = dto.emailClaim;
      if (dto.allowedDomains !== undefined) provider.allowedDomains = dto.allowedDomains;
      provider.enabled = dto.enabled;
      provider.enforced = dto.enforced;
    }

    provider.lastTestedAt = discovered.ok ? new Date() : provider.lastTestedAt;
    provider.lastTestError = discovered.ok ? null : discovered.error;

    await this.em.persistAndFlush(provider);

    return this.toSettings(provider);
  }

  async deleteSettings(organizationId: string): Promise<void> {
    const provider = await this.em.findOne(SsoProvider, { organization: organizationId });
    if (provider) await this.em.removeAndFlush(provider);
  }

  /**
   * Fetches discovery for the form's current values without saving anything. When a
   * provider already exists, the result is also recorded onto it — the same
   * `lastTestedAt`/`lastTestError` a save would set — so a successful standalone test
   * is not lost the next time the settings screen loads.
   */
  async test(organizationId: string, dto: TestSsoSettingsDto): Promise<SsoTestResult> {
    this.requireCipher();

    const provider = await this.em.findOne(SsoProvider, { organization: organizationId });
    const clientSecret = dto.clientSecret ?? (provider ? this.decryptSecret(provider) : undefined);
    if (!clientSecret) {
      throw new BadRequestException('a client secret is required to test the connection');
    }

    const discovered = await this.tryDiscover({
      issuerUrl: dto.issuerUrl,
      clientId: dto.clientId,
      clientSecret,
    });

    if (provider) {
      provider.lastTestedAt = discovered.ok ? new Date() : provider.lastTestedAt;
      provider.lastTestError = discovered.ok ? null : discovered.error;
      await this.em.flush();
    }

    if (!discovered.ok) throw new BadRequestException(discovered.error);

    return discovered.endpoints;
  }

  /**
   * Begins an authorization request: a fresh PKCE pair, `state` and `nonce`, recorded
   * as a single-use `SsoLoginAttempt` and handed back as a URL — the caller is `fetch`
   * inside the SPA, which cannot usefully follow a cross-origin redirect itself.
   */
  async start(userAgent: string | undefined): Promise<{ authorizationUrl: string }> {
    const provider = await this.currentProvider();
    if (!provider?.enabled) throw new ForbiddenException('sso_disabled' satisfies SsoErrorCode);

    await this.sweepExpiredAttempts();

    const { configuration } = await this.oidc.discover(this.configFor(provider));
    const request = await this.oidc.buildAuthorizationRequest(
      configuration,
      this.redirectUri(),
      provider.scopes,
    );

    this.em.create(SsoLoginAttempt, {
      organization: provider.organization,
      stateHash: hashState(request.state),
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });
    await this.em.flush();

    return { authorizationUrl: request.authorizationUrl };
  }

  /**
   * Resolves the callback into a session, or a named `SsoErrorCode` the caller
   * redirects the browser to `/login?error=` with. Never throws for an expected
   * failure — a wrong nonce or an unknown address is routine here, not exceptional.
   */
  async finish(query: URLSearchParams, userAgent: string | undefined): Promise<SsoLoginOutcome> {
    // An IdP that refused — a denied consent, an unknown client — redirects back with
    // `error` and no code. Reading it here is what tells that apart from a response
    // that failed verification, which used to come back as `invalid_token`.
    if (query.get('error')) return { errorCode: 'exchange_failed' };

    const state = query.get('state');
    if (!state) return { errorCode: 'invalid_state' };

    // Rebuilt from configuration, never from request headers — see the callback
    // handler in `sso-auth.controller.ts`. This is the URL `openid-client` reads the
    // code and state out of, and the one it derives `redirect_uri` from.
    const callbackUrl = new URL(this.redirectUri());
    for (const [key, value] of query) callbackUrl.searchParams.append(key, value);

    const attempt = await this.em.findOne(
      SsoLoginAttempt,
      { stateHash: hashState(state) },
      { populate: ['organization'] },
    );
    // Single-use: a consumed or expired row is a hard refusal — see the entity's doc.
    if (!attempt || attempt.consumedAt || attempt.expiresAt.getTime() <= Date.now()) {
      return { errorCode: 'invalid_state' };
    }
    attempt.consumedAt = new Date();

    const organizationId = attempt.organization.id;
    const provider = await this.em.findOne(SsoProvider, { organization: organizationId });
    if (!provider?.enabled) {
      await this.em.flush();
      return { errorCode: 'sso_disabled' };
    }

    let configuration: client.Configuration;
    try {
      ({ configuration } = await this.oidc.discover(this.configFor(provider)));
    } catch {
      await this.em.flush();
      return { errorCode: 'exchange_failed' };
    }

    let claims: Record<string, unknown>;
    try {
      claims = await this.oidc.exchange(configuration, callbackUrl, {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
    } catch {
      await this.em.flush();
      return { errorCode: 'invalid_token' };
    }

    const emailClaim = claims[provider.emailClaim];
    if (typeof emailClaim !== 'string' || !emailClaim.includes('@')) {
      await this.em.flush();
      return { errorCode: 'no_email' };
    }
    const email = emailClaim.toLowerCase();

    if (provider.allowedDomains.length > 0) {
      const domain = email.split('@')[1] ?? '';
      if (!provider.allowedDomains.includes(domain)) {
        await this.em.flush();
        return { errorCode: 'domain_not_allowed' };
      }
    }

    let user: User | null = await this.em.findOne(User, { organization: organizationId, email });

    // The IdP has proved the address, so a pending invitation for it is accepted here
    // rather than refused — see InvitationsService.acceptForFederatedEmail.
    if (!user) {
      user = await this.invitations.acceptForFederatedEmail(organizationId, email);
    }

    await this.em.flush();

    if (!user) return { errorCode: 'no_account' };
    if (user.status !== UserStatus.Active) return { errorCode: 'account_disabled' };

    // startSessionFor populates roles and organization itself.
    return { session: await this.auth.startSessionFor(user, userAgent) };
  }

  private async currentProvider(): Promise<SsoProvider | null> {
    const organization = await this.organizations.theOnlyOrganization();
    if (!organization) return null;

    return this.em.findOne(SsoProvider, { organization: organization.id });
  }

  private async sweepExpiredAttempts(): Promise<void> {
    await this.em.nativeDelete(SsoLoginAttempt, { expiresAt: { $lt: new Date() } });
  }

  private configFor(provider: SsoProvider): OidcProviderConfig {
    return {
      issuerUrl: provider.issuerUrl,
      clientId: provider.clientId,
      clientSecret: this.decryptSecret(provider),
    };
  }

  private decryptSecret(provider: SsoProvider): string {
    return this.cipher.decrypt({
      ciphertext: provider.clientSecretCiphertext,
      iv: provider.clientSecretIv,
    });
  }

  private async tryDiscover(
    provider: OidcProviderConfig,
  ): Promise<{ ok: true; endpoints: SsoTestResult } | { ok: false; error: string }> {
    try {
      const { endpoints } = await this.oidc.discover(provider);

      return { ok: true, endpoints };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'discovery failed' };
    }
  }

  private toSettings(provider: SsoProvider): SsoSettings {
    return {
      protocol: provider.protocol,
      displayName: provider.displayName,
      issuerUrl: provider.issuerUrl,
      clientId: provider.clientId,
      hasClientSecret: true,
      scopes: provider.scopes,
      emailClaim: provider.emailClaim,
      allowedDomains: provider.allowedDomains,
      enabled: provider.enabled,
      enforced: provider.enforced,
      lastTestedAt: provider.lastTestedAt?.toISOString() ?? null,
      lastTestError: provider.lastTestError,
      redirectUri: this.redirectUri(),
    };
  }

  private redirectUri(): string {
    const base = this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000';

    return `${base.replace(/\/+$/, '')}/api/auth/sso/callback`;
  }

  private requireCipher(): void {
    if (!this.cipher.isConfigured()) {
      throw new ServiceUnavailableException('SSO_ENCRYPTION_KEY is not configured on this installation');
    }
  }
}
