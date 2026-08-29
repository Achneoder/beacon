import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SsoService } from './sso.service.js';
import { SsoLoginAttempt } from './sso-login-attempt.entity.js';
import { SsoProvider } from './sso-provider.entity.js';

type FindOneImpl = (entity: unknown, where: unknown) => unknown;

function buildService(findOne: FindOneImpl = () => null) {
  const em = {
    findOne: vi.fn(findOne),
    flush: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    persistAndFlush: vi.fn().mockResolvedValue(undefined),
    removeAndFlush: vi.fn().mockResolvedValue(undefined),
    nativeDelete: vi.fn().mockResolvedValue(0),
    getReference: vi.fn(),
  };
  const config = { get: vi.fn().mockReturnValue(undefined) };
  const cipher = {
    isConfigured: () => true,
    encrypt: vi.fn(),
    decrypt: vi.fn().mockReturnValue('decrypted-secret'),
  };
  const oidc = { discover: vi.fn(), buildAuthorizationRequest: vi.fn(), exchange: vi.fn() };
  const organizations = { theOnlyOrganization: vi.fn() };
  const invitations = { acceptForFederatedEmail: vi.fn() };
  const auth = { startSessionFor: vi.fn() };

  const service = new SsoService(
    em as never,
    config as never,
    cipher as never,
    oidc as never,
    organizations as never,
    invitations as never,
    auth as never,
  );

  return { service, em, oidc, invitations, auth, organizations, cipher };
}

const CALLBACK_URL = new URL('https://api.beacon.test/api/auth/sso/callback?state=abc&code=xyz');

describe('SsoService.finish — single-use and expiry', () => {
  it('refuses when the state carries no matching attempt', async () => {
    const { service } = buildService(() => null);

    expect(await service.finish(CALLBACK_URL, undefined)).toEqual({ errorCode: 'invalid_state' });
  });

  it('refuses a callback with no state parameter at all', async () => {
    const { service } = buildService();
    const url = new URL('https://api.beacon.test/api/auth/sso/callback?code=xyz');

    expect(await service.finish(url, undefined)).toEqual({ errorCode: 'invalid_state' });
  });

  it('refuses an already-consumed attempt — a replayed callback', async () => {
    const attempt = {
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      organization: { id: 'org-1' },
    };
    const { service, em } = buildService((entity) => (entity === SsoLoginAttempt ? attempt : null));

    expect(await service.finish(CALLBACK_URL, undefined)).toEqual({ errorCode: 'invalid_state' });
    // Never reaches the provider lookup — a spent attempt is refused before anything else runs.
    expect(em.findOne).not.toHaveBeenCalledWith(SsoProvider, expect.anything());
  });

  it('refuses an expired attempt', async () => {
    const attempt = {
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      organization: { id: 'org-1' },
    };
    const { service } = buildService((entity) => (entity === SsoLoginAttempt ? attempt : null));

    expect(await service.finish(CALLBACK_URL, undefined)).toEqual({ errorCode: 'invalid_state' });
  });

  it('consumes the attempt exactly once it is accepted for exchange', async () => {
    const attempt = {
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
      organization: { id: 'org-1' },
    };
    const { service } = buildService((entity) => {
      if (entity === SsoLoginAttempt) return attempt;
      if (entity === SsoProvider) return null; // sso disabled — short-circuits after consuming
      return null;
    });

    await service.finish(CALLBACK_URL, undefined);

    expect(attempt.consumedAt).not.toBeNull();
  });
});

describe('SsoService settings mapper', () => {
  const provider = {
    protocol: 'oidc' as const,
    displayName: 'Okta',
    issuerUrl: 'https://okta.example',
    clientId: 'client-1',
    clientSecretCiphertext: 'super-secret-ciphertext',
    clientSecretIv: 'iv-value',
    scopes: 'openid email profile',
    emailClaim: 'email',
    allowedDomains: [] as string[],
    enabled: true,
    enforced: false,
    lastTestedAt: null,
    lastTestError: null,
  };

  it('never returns the client secret, only that one is stored', async () => {
    const { service } = buildService((entity) => (entity === SsoProvider ? provider : null));

    const settings = await service.getSettings('org-1');

    expect(settings).not.toHaveProperty('clientSecretCiphertext');
    expect(settings).not.toHaveProperty('clientSecretIv');
    expect(settings).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(settings)).not.toContain('super-secret-ciphertext');
    expect(settings.hasClientSecret).toBe(true);
  });

  it('throws when nothing is configured yet', async () => {
    const { service } = buildService(() => null);

    await expect(service.getSettings('org-1')).rejects.toThrow(NotFoundException);
  });
});
