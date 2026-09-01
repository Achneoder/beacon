import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService, toSessionUser } from './auth.service.js';
import { SsoProvider } from '../sso/sso-provider.entity.js';
import { User, UserStatus } from '../users/user.entity.js';

interface FakeUser {
  id: string;
  email: string;
  passwordHash: string | null;
  status: UserStatus;
  organization: { id: string; getEntity: () => { id: string; name: string; slug: string } };
  roles: { getItems: () => never[] };
  permissions: string[];
  firstName: string;
  lastName: string;
  locale: string;
  timezone: string | null;
  jobTitle: string | null;
  lastLoginAt: Date | null;
}

function fakeUser(permissions: string[]): FakeUser {
  return {
    id: 'user-1',
    email: 'ada@acme.test',
    passwordHash: 'hashed-password',
    status: UserStatus.Active,
    organization: { id: 'org-1', getEntity: () => ({ id: 'org-1', name: 'Acme', slug: 'acme' }) },
    roles: { getItems: () => [] },
    permissions,
    firstName: 'Ada',
    lastName: 'Lovelace',
    locale: 'en',
    timezone: null,
    jobTitle: null,
    lastLoginAt: null,
  };
}

function buildService(user: FakeUser, provider: { enabled: boolean; enforced: boolean } | null) {
  const em = {
    findOne: vi.fn((entity: unknown) => {
      if (entity === SsoProvider) return Promise.resolve(provider);
      if (entity === User) return Promise.resolve(user);
      return Promise.resolve(null);
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed.jwt.token') };
  const config = { get: vi.fn().mockReturnValue(undefined) };
  const passwords = { verify: vi.fn().mockResolvedValue(true), hash: vi.fn() };
  const organizations = {};

  const service = new AuthService(
    em as never,
    jwt as never,
    config as never,
    passwords as never,
    organizations as never,
  );

  return { service, em };
}

const CREDENTIALS = { email: 'ada@acme.test', password: 'correct-horse-battery' };

describe('AuthService.login — sso enforcement', () => {
  it('signs in normally when no provider is configured', async () => {
    const { service } = buildService(fakeUser([]), null);

    await expect(service.login(CREDENTIALS)).resolves.toMatchObject({
      auth: { user: { email: 'ada@acme.test' } },
    });
  });

  it('signs in normally when sso is configured but not enforced', async () => {
    const { service } = buildService(fakeUser([]), { enabled: true, enforced: false });

    await expect(service.login(CREDENTIALS)).resolves.toBeDefined();
  });

  it('refuses a password login once sso is enforced', async () => {
    const { service } = buildService(fakeUser(['attendance:read']), { enabled: true, enforced: true });

    await expect(service.login(CREDENTIALS)).rejects.toThrow(ForbiddenException);
    await expect(service.login(CREDENTIALS)).rejects.toThrow('sso_required');
  });

  it('still admits organization:manage under enforcement', async () => {
    const { service } = buildService(fakeUser(['organization:manage']), {
      enabled: true,
      enforced: true,
    });

    await expect(service.login(CREDENTIALS)).resolves.toBeDefined();
  });

  it('checks permissions, not a role name — enforcement never inspects roleKeys', async () => {
    // A manager with organization:manage granted ad hoc (not through the owner role)
    // must still get through; the check is the permission union alone.
    const { service } = buildService(fakeUser(['organization:manage', 'employee:read']), {
      enabled: true,
      enforced: true,
    });

    await expect(service.login(CREDENTIALS)).resolves.toBeDefined();
  });

  it('does not enforce when the provider row exists but is disabled', async () => {
    const { service } = buildService(fakeUser([]), { enabled: false, enforced: true });

    await expect(service.login(CREDENTIALS)).resolves.toBeDefined();
  });

  it('still refuses invalid credentials before the sso check ever runs', async () => {
    const { service, em } = buildService(fakeUser([]), { enabled: true, enforced: true });
    em.findOne.mockImplementation((entity: unknown) => (entity === User ? Promise.resolve(null) : Promise.resolve(null)));

    await expect(service.login(CREDENTIALS)).rejects.toThrow(UnauthorizedException);
  });
});

describe('toSessionUser', () => {
  const sessionSource = (locale: string | null, defaultLocale: string) =>
    ({
      id: 'user-1',
      email: 'ada@acme.test',
      permissions: [],
      firstName: 'Ada',
      lastName: 'Lovelace',
      locale,
      timezone: null,
      jobTitle: null,
      roles: { getItems: () => [] },
      organization: {
        getEntity: () => ({ id: 'org-1', name: 'Acme', slug: 'acme', defaultLocale }),
      },
    }) as unknown as User;

  it('hands the SPA the organization default when the user chose no language', () => {
    // The bug this replaced: `users.locale` was `not null default 'en'`, so setting the
    // organization's default language moved nobody and the whole install stayed English.
    expect(toSessionUser(sessionSource(null, 'de')).locale).toBe('de');
  });

  it("prefers the user's own choice over the organization's default", () => {
    expect(toSessionUser(sessionSource('en', 'de')).locale).toBe('en');
  });

  it('falls back to english when neither is a language Beacon ships', () => {
    expect(toSessionUser(sessionSource(null, 'fr')).locale).toBe('en');
  });
});
