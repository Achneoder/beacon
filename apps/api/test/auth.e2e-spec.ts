import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { Organization } from '../src/modules/organizations/organization.entity.js';

/** Every run gets its own tenant, so repeated runs never collide. */
const RUN = Date.now().toString(36);
const ORG_NAME = `Acme ${RUN}`;
const EMAIL = `owner.${RUN}@acme.test`;
const PASSWORD = 'correct-horse-battery';

function refreshCookie(response: request.Response): string {
  const cookies = response.get('Set-Cookie') ?? [];
  const cookie = cookies.find((value) => value.startsWith('beacon_refresh='));
  if (!cookie) throw new Error('no refresh cookie was set');

  return cookie.split(';')[0];
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let accessToken: string;
  let firstCookie: string;
  let organizationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    orm = app.get(MikroORM);
  });

  afterAll(async () => {
    // Cascades through roles, users and refresh tokens via the organization.
    if (orm && organizationId) {
      const em = orm.em.fork();
      await em.nativeDelete('refresh_tokens', { organization_id: organizationId });
      await em.nativeDelete('user_roles', {});
      await em.nativeDelete('users', { organization_id: organizationId });
      await em.nativeDelete('roles', { organization_id: organizationId });
      await em.nativeDelete(Organization, { id: organizationId });
    }
    await app?.close();
  });

  describe('registration', () => {
    it('creates the organization, its owner and a session', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          organizationName: ORG_NAME,
          email: EMAIL,
          password: PASSWORD,
          firstName: 'Ada',
          lastName: 'Lovelace',
        })
        .expect(201);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({
        email: EMAIL,
        firstName: 'Ada',
        organizationName: ORG_NAME,
        roleKeys: ['owner'],
      });
      // The owner holds every permission, including the one nobody else gets.
      expect(response.body.user.permissions).toContain('organization:manage');

      expect(refreshCookie(response)).toContain('beacon_refresh=');
      expect(response.get('Set-Cookie')?.[0]).toContain('HttpOnly');

      accessToken = response.body.accessToken;
      firstCookie = refreshCookie(response);
      organizationId = response.body.user.organizationId;
    });

    it('rejects a password below the minimum length', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          organizationName: 'Too Short',
          email: `short.${RUN}@acme.test`,
          password: 'short',
          firstName: 'A',
          lastName: 'B',
        })
        .expect(400);
    });

    it('rejects unknown properties', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          organizationName: 'Sneaky',
          email: `sneaky.${RUN}@acme.test`,
          password: PASSWORD,
          firstName: 'A',
          lastName: 'B',
          isSuperUser: true,
        })
        .expect(400);
    });
  });

  describe('login', () => {
    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: 'not-the-password' })
        .expect(401);
    });

    it('rejects an unknown address the same way', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: `nobody.${RUN}@acme.test`, password: PASSWORD })
        .expect(401);
    });

    it('issues a session for the right password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      expect(response.body.user.email).toBe(EMAIL);
      expect(refreshCookie(response)).toBeTruthy();
    });
  });

  describe('the session', () => {
    it('refuses /auth/me without a token', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it('returns the current user for a valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ email: EMAIL, organizationId });
    });

    it('rotates the refresh token, and refuses the spent one', async () => {
      const rotated = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(200);

      expect(rotated.body.accessToken).toEqual(expect.any(String));
      expect(refreshCookie(rotated)).not.toBe(firstCookie);

      // Replaying the spent token is treated as a leak.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(401);
    });

    it('refuses to refresh without a cookie', async () => {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    });
  });

  describe('organization access', () => {
    it('refuses an anonymous request', async () => {
      await request(app.getHttpServer()).get('/api/organizations/current').expect(401);
    });

    it('lets the owner read and update their organization', async () => {
      const read = await request(app.getHttpServer())
        .get('/api/organizations/current')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(read.body).toMatchObject({ id: organizationId, name: ORG_NAME });

      const updated = await request(app.getHttpServer())
        .patch('/api/organizations/current')
        .set('authorization', `Bearer ${accessToken}`)
        .send({ timezone: 'Europe/Berlin' })
        .expect(200);

      expect(updated.body.timezone).toBe('Europe/Berlin');
    });

    it('seeds the four built-in roles', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/organizations/current/roles')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.map((role: { key: string }) => role.key)).toEqual([
        'admin',
        'employee',
        'manager',
        'owner',
      ]);
      expect(response.body.every((role: { isSystem: boolean }) => role.isSystem)).toBe(true);
    });

    it('returns 403 when the token lacks the permission', async () => {
      // A valid token carrying only a read permission — the first real proof that
      // PermissionsGuard runs on every request.
      const readOnly = app.get(JwtService).sign({
        sub: 'someone',
        org: organizationId,
        email: EMAIL,
        permissions: ['organization:read'],
      });

      await request(app.getHttpServer())
        .patch('/api/organizations/current')
        .set('authorization', `Bearer ${readOnly}`)
        .send({ timezone: 'UTC' })
        .expect(403);
    });
  });

  describe('logout', () => {
    it('revokes the session so the cookie can no longer refresh', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      const cookie = refreshCookie(login);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('authorization', `Bearer ${login.body.accessToken}`)
        .set('Cookie', cookie)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });
  });
});
