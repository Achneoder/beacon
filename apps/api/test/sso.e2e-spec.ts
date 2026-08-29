import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';
import { FakeIdp } from './fake-idp.js';

/**
 * Names are still run-unique, so a failed run leaving data behind is easy to read in
 * the database — the reset in `beforeAll` is what actually keeps runs from colliding.
 */
const RUN = Date.now().toString(36);
const ORG_NAME = `Sso ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@sso.test`;
const PASSWORD = 'correct-horse-battery';
const CLIENT_ID = 'beacon-client';
const CLIENT_SECRET = 'beacon-client-secret';

function hasRefreshCookie(response: request.Response): boolean {
  const cookies = response.get('Set-Cookie') ?? [];

  return cookies.some((value) => value.startsWith('beacon_refresh='));
}

/** The bits of the authorization URL Beacon hands back that a browser would carry to
 * the IdP and the IdP would echo into the callback and the ID token. */
function paramsOf(authorizationUrl: string): { state: string; nonce: string } {
  const url = new URL(authorizationUrl);

  return {
    state: url.searchParams.get('state') ?? '',
    nonce: url.searchParams.get('nonce') ?? '',
  };
}

describe('SSO (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let idp: FakeIdp;
  let owner: string;
  let organizationId: string;

  const auth = () => ({ Authorization: `Bearer ${owner}` });

  const configureProvider = (overrides: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .put('/api/sso/settings')
      .set(auth())
      .send({
        displayName: 'Fake IdP',
        issuerUrl: idp.issuerUrl,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        enabled: true,
        enforced: false,
        allowedDomains: [],
        ...overrides,
      });

  beforeAll(async () => {
    idp = new FakeIdp();
    await idp.start();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    orm = app.get(MikroORM);
    // Registration installs the instance and then refuses forever, so every file has to
    // start from an empty database. Files run one at a time — see vitest.config.e2e.ts.
    await resetInstance(orm);

    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: ORG_NAME,
        email: OWNER_EMAIL,
        password: PASSWORD,
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      .expect(201);

    owner = registration.body.accessToken;
    organizationId = registration.body.user.organizationId;
  });

  afterAll(async () => {
    // Nothing to tear down: the next file resets the database before it installs.
    await app?.close();
    await idp.stop();
  });

  describe('before anything is configured', () => {
    it('reports sso as unavailable on the login screen', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/sso').expect(200);

      expect(response.body).toEqual({ enabled: false, displayName: null, enforced: false });
    });

    it('refuses to start an authorization request', async () => {
      await request(app.getHttpServer()).post('/api/auth/sso/start').expect(403);
    });

    it('404s reading settings that do not exist yet', async () => {
      await request(app.getHttpServer()).get('/api/sso/settings').set(auth()).expect(404);
    });
  });

  describe('settings — permissions', () => {
    it('refuses an anonymous read', async () => {
      await request(app.getHttpServer()).get('/api/sso/settings').expect(401);
    });

    it('refuses a caller without organization:manage', async () => {
      // A valid token carrying only a read permission — PermissionsGuard's own proof,
      // mirrored from auth.e2e-spec.ts's "returns 403 when the token lacks the permission".
      const readOnly = app.get(JwtService).sign({
        sub: 'someone',
        org: organizationId,
        email: OWNER_EMAIL,
        permissions: ['organization:read'],
      });

      await request(app.getHttpServer())
        .get('/api/sso/settings')
        .set('authorization', `Bearer ${readOnly}`)
        .expect(403);
    });
  });

  describe('configuring a provider', () => {
    it('rejects an issuer that is neither https nor loopback', async () => {
      await configureProvider({ issuerUrl: 'http://sso.example.com' }).expect(400);
    });

    it('rejects enabling a provider whose issuer cannot be discovered', async () => {
      await configureProvider({ issuerUrl: 'http://127.0.0.1:1' }).expect(400);
    });

    it('saves, discovers the issuer, and never returns the secret', async () => {
      const response = await configureProvider().expect(200);

      expect(response.body).toMatchObject({
        displayName: 'Fake IdP',
        issuerUrl: idp.issuerUrl,
        clientId: CLIENT_ID,
        hasClientSecret: true,
        enabled: true,
        enforced: false,
        lastTestError: null,
      });
      expect(response.body.lastTestedAt).toEqual(expect.any(String));
      expect(response.body.redirectUri).toContain('/api/auth/sso/callback');
      expect(JSON.stringify(response.body)).not.toContain(CLIENT_SECRET);
    });

    it('the login screen now offers the button', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/sso').expect(200);

      expect(response.body).toEqual({ enabled: true, displayName: 'Fake IdP', enforced: false });
    });

    it('a save that omits the secret keeps the stored one working', async () => {
      await request(app.getHttpServer())
        .put('/api/sso/settings')
        .set(auth())
        .send({
          displayName: 'Fake IdP (renamed)',
          issuerUrl: idp.issuerUrl,
          clientId: CLIENT_ID,
          enabled: true,
          enforced: false,
        })
        .expect(200);

      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      expect(start.body.authorizationUrl).toContain(idp.issuerUrl);

      // put the display name back for the specs below.
      await configureProvider().expect(200);
    });

    it('test connection reports the discovered endpoints without saving anything enabled', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/sso/settings/test')
        .set(auth())
        .send({ issuerUrl: idp.issuerUrl, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
        .expect(201);

      expect(response.body).toEqual({
        issuer: idp.issuerUrl,
        authorizationEndpoint: `${idp.issuerUrl}/authorize`,
        tokenEndpoint: `${idp.issuerUrl}/token`,
        jwksUri: `${idp.issuerUrl}/jwks`,
      });
    });
  });

  describe('the login round trip', () => {
    const inviteeEmail = `invitee.${RUN}@sso.test`;

    it('invites a member who will sign in through the IdP instead of the emailed link', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations')
        .set(auth())
        .send({ email: inviteeEmail, firstName: 'Alan', lastName: 'Turing' })
        .expect(201);
    });

    it('accepts the pending invitation on first sso login and signs the member in', async () => {
      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      const { state, nonce } = paramsOf(start.body.authorizationUrl);
      const code = idp.issueCode({ email: inviteeEmail, nonce });

      const callback = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code, state })
        .expect(302);

      expect(callback.headers.location).not.toMatch(/[?&]error=/);
      expect(hasRefreshCookie(callback)).toBe(true);
    });

    it('the accepted invitation is now a real, active, password-less account', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users')
        .set(auth())
        .expect(200);

      const member = response.body.find((u: { email: string }) => u.email === inviteeEmail);
      expect(member).toMatchObject({ email: inviteeEmail, status: 'active' });

      // Password sign-in never worked for this account — it has none.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: inviteeEmail, password: 'anything-at-all-12345' })
        .expect(401);
    });

    it('a second sso login for the same person resolves the account directly', async () => {
      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      const { state, nonce } = paramsOf(start.body.authorizationUrl);
      const code = idp.issueCode({ email: inviteeEmail, nonce });

      const callback = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code, state })
        .expect(302);

      expect(callback.headers.location).not.toMatch(/[?&]error=/);
    });
  });

  describe('failure modes', () => {
    it('refuses an address with neither an account nor a pending invitation', async () => {
      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      const { state, nonce } = paramsOf(start.body.authorizationUrl);
      const code = idp.issueCode({ email: `nobody.${RUN}@sso.test`, nonce });

      const callback = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code, state })
        .expect(302);

      expect(callback.headers.location).toContain('error=no_account');
    });

    it('refuses a replayed state — the attempt was already consumed', async () => {
      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      const { state, nonce } = paramsOf(start.body.authorizationUrl);
      const email = `replay.${RUN}@sso.test`;

      const firstCode = idp.issueCode({ email, nonce });
      const first = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code: firstCode, state })
        .expect(302);
      // Unknown address, but the attempt is consumed either way.
      expect(first.headers.location).toContain('error=no_account');

      const secondCode = idp.issueCode({ email, nonce });
      const second = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code: secondCode, state })
        .expect(302);
      expect(second.headers.location).toContain('error=invalid_state');
    });

    it('refuses a callback with no matching attempt at all', async () => {
      const callback = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code: 'whatever', state: 'not-a-real-state' })
        .expect(302);

      expect(callback.headers.location).toContain('error=invalid_state');
    });

    it('refuses an id token whose nonce does not match the attempt', async () => {
      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      const { state } = paramsOf(start.body.authorizationUrl);
      // The real nonce is discarded — the IdP echoing a different one is exactly what a
      // forged or buggy authorization response looks like.
      const code = idp.issueCode({ email: `wrongnonce.${RUN}@sso.test`, nonce: 'not-the-real-nonce' });

      const callback = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code, state })
        .expect(302);

      expect(callback.headers.location).toContain('error=invalid_token');
    });

    it('refuses an email claim outside the allowed domains', async () => {
      await configureProvider({ allowedDomains: ['sso.test'] }).expect(200);

      const start = await request(app.getHttpServer()).post('/api/auth/sso/start').expect(200);
      const { state, nonce } = paramsOf(start.body.authorizationUrl);
      const code = idp.issueCode({ email: 'someone@not-allowed.test', nonce });

      const callback = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code, state })
        .expect(302);

      expect(callback.headers.location).toContain('error=domain_not_allowed');

      await configureProvider({ allowedDomains: [] }).expect(200);
    });
  });

  describe('enforcement', () => {
    const memberEmail = `enforced.${RUN}@sso.test`;

    it('sets up a password-holding member to enforce against', async () => {
      const invitation = await request(app.getHttpServer())
        .post('/api/invitations')
        .set(auth())
        .send({ email: memberEmail, firstName: 'Grace', lastName: 'Hopper' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .send({ token: invitation.body.token, password: PASSWORD })
        .expect(201);
    });

    it('refuses password login for a non-admin once enforced', async () => {
      await configureProvider({ enforced: true }).expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: memberEmail, password: PASSWORD })
        .expect(403);
    });

    it('still admits organization:manage under enforcement', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: OWNER_EMAIL, password: PASSWORD })
        .expect(200);

      await configureProvider({ enforced: false }).expect(200);
    });
  });

  describe('deleting the provider', () => {
    it('removes it, and the login screen stops offering it', async () => {
      await request(app.getHttpServer()).delete('/api/sso/settings').set(auth()).expect(204);

      const publicState = await request(app.getHttpServer()).get('/api/auth/sso').expect(200);
      expect(publicState.body).toEqual({ enabled: false, displayName: null, enforced: false });

      await request(app.getHttpServer()).get('/api/sso/settings').set(auth()).expect(404);
    });
  });
});
