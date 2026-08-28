import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

/**
 * Names are still run-unique, so a failed run leaving data behind is easy to read in
 * the database — the reset in `beforeAll` is what actually keeps runs from colliding.
 */
const RUN = Date.now().toString(36);
const ORG_NAME = `People ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@people.test`;
const INVITEE_EMAIL = `newcomer.${RUN}@people.test`;
const PASSWORD = 'correct-horse-battery';

describe('People (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let owner: string;
  let departmentId: string;
  let teamId: string;
  let ownerId: string;

  const auth = () => ({ Authorization: `Bearer ${owner}` });

  beforeAll(async () => {
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
    ownerId = registration.body.user.id;
  });

  afterAll(async () => {
    // Nothing to tear down: the next file resets the database before it installs.
    await app?.close();
  });

  describe('departments and teams', () => {
    it('creates a department and files a team under it', async () => {
      const department = await request(app.getHttpServer())
        .post('/api/departments')
        .set(auth())
        .send({ name: 'Engineering' })
        .expect(201);

      departmentId = department.body.id;
      expect(department.body).toMatchObject({ name: 'Engineering', memberCount: 0 });

      const team = await request(app.getHttpServer())
        .post('/api/teams')
        .set(auth())
        .send({ name: 'Platform', departmentId })
        .expect(201);

      teamId = team.body.id;
      expect(team.body.departmentId).toBe(departmentId);
    });

    it('rejects a duplicate department name within the organization', async () => {
      await request(app.getHttpServer())
        .post('/api/departments')
        .set(auth())
        .send({ name: 'Engineering' })
        .expect(409);
    });
  });

  describe('users', () => {
    let createdId: string;

    it('creates a user, numbers them and files them under the department', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({
          email: `grace.${RUN}@people.test`,
          firstName: 'Grace',
          lastName: 'Hopper',
          jobTitle: 'Staff Engineer',
          departmentId,
          teamId,
          managerId: ownerId,
          contractType: 'permanent-full-time',
          office: 'Berlin',
          workLocation: 'hybrid',
          startsOn: '2026-09-01',
        })
        .expect(201);

      createdId = response.body.id;
      expect(response.body).toMatchObject({
        employeeNumber: expect.stringMatching(/^BCN-\d{4}$/),
        status: 'invited',
        departmentName: 'Engineering',
        teamName: 'Platform',
        managerName: 'Ada Lovelace',
        jobTitle: 'Staff Engineer',
      });
      // Roles default to `employee` when the caller names none.
      expect(response.body.roles.map((role: { key: string }) => role.key)).toEqual(['employee']);
    });

    it('refuses a second user with the same address in the tenant', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: OWNER_EMAIL, firstName: 'Impostor', lastName: 'Owner' })
        .expect(409);
    });

    it('refuses a management cycle', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${ownerId}`)
        .set(auth())
        .send({ managerId: createdId })
        .expect(400);
    });

    it('filters the list by department and by search', async () => {
      const byDepartment = await request(app.getHttpServer())
        .get(`/api/users?departmentId=${departmentId}`)
        .set(auth())
        .expect(200);
      expect(byDepartment.body).toHaveLength(1);

      const bySearch = await request(app.getHttpServer())
        .get('/api/users?search=lovelace')
        .set(auth())
        .expect(200);
      expect(bySearch.body[0].email).toBe(OWNER_EMAIL);
    });

    it('lets a person change their own phone and zone', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/users/me')
        .set(auth())
        .send({ phone: '+49 30 123456', timezone: 'Europe/Berlin' })
        .expect(200);

      expect(response.body).toMatchObject({ phone: '+49 30 123456', timezone: 'Europe/Berlin' });
    });

    it('refuses an employment field smuggled into the self-service patch', async () => {
      // The DTO whitelist is the guard: a person cannot promote themselves by
      // patching their own job title, even holding employee:manage.
      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set(auth())
        .send({ jobTitle: 'CEO' })
        .expect(400);
    });

    it('disables rather than deletes, and refuses self-disabling', async () => {
      await request(app.getHttpServer()).delete(`/api/users/${ownerId}`).set(auth()).expect(400);

      const response = await request(app.getHttpServer())
        .delete(`/api/users/${createdId}`)
        .set(auth())
        .expect(200);

      expect(response.body.status).toBe('disabled');

      // Still readable: attendance and document history must keep its author.
      await request(app.getHttpServer()).get(`/api/users/${createdId}`).set(auth()).expect(200);
    });
  });

  /**
   * The member count is a grouped aggregate, and the query builder quotes a plain
   * select string as a property name — so `count(*)` only breaks when the *list*
   * endpoints run. Creating a department never touched that SQL, which is how a 500
   * on the settings screen went unnoticed.
   */
  describe('department and team listings', () => {
    it('counts the people filed under each', async () => {
      const departments = await request(app.getHttpServer())
        .get('/api/departments')
        .set(auth())
        .expect(200);

      // Grace was filed under Engineering / Platform above.
      expect(departments.body).toContainEqual(
        expect.objectContaining({ id: departmentId, name: 'Engineering', memberCount: 1 }),
      );

      const teams = await request(app.getHttpServer())
        .get('/api/teams')
        .set(auth())
        .expect(200);

      expect(teams.body).toContainEqual(
        expect.objectContaining({ id: teamId, name: 'Platform', memberCount: 1 }),
      );
    });
  });

  describe('invitations', () => {
    let token: string;
    let invitationId: string;

    it('hands the token back exactly once, with a link into the web app', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invitations')
        .set(auth())
        .send({
          email: INVITEE_EMAIL,
          firstName: 'Alan',
          lastName: 'Turing',
          jobTitle: 'Cryptanalyst',
          departmentId,
        })
        .expect(201);

      token = response.body.token;
      invitationId = response.body.id;

      expect(token).toEqual(expect.any(String));
      expect(response.body.acceptUrl).toContain(`/invite/${token}`);
      expect(response.body).toMatchObject({ invitedByName: 'Ada Lovelace', isExpired: false });

      // The listing never carries the token — only its digest is stored.
      const listed = await request(app.getHttpServer())
        .get('/api/invitations')
        .set(auth())
        .expect(200);
      expect(listed.body[0].token).toBeUndefined();
    });

    it('accepts without any credential but the token, and signs the invitee in', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .send({ token, password: PASSWORD })
        .expect(201);

      expect(response.body.user).toMatchObject({
        email: INVITEE_EMAIL,
        firstName: 'Alan',
        jobTitle: 'Cryptanalyst',
        organizationName: ORG_NAME,
      });
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.get('Set-Cookie')?.some((c) => c.startsWith('beacon_refresh='))).toBe(true);
    });

    it('refuses to replay a spent token', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .send({ token, password: PASSWORD })
        .expect(400);
    });

    it('marks the invitation accepted', async () => {
      const listed = await request(app.getHttpServer())
        .get('/api/invitations')
        .set(auth())
        .expect(200);

      const invitation = listed.body.find((row: { id: string }) => row.id === invitationId);
      expect(invitation.acceptedAt).toEqual(expect.any(String));
    });
  });

  describe('authorization', () => {
    it('refuses an anonymous read of the people list', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('refuses an employee-level token the manage routes', async () => {
      const invitee = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: INVITEE_EMAIL, password: PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/departments')
        .set({ Authorization: `Bearer ${invitee.body.accessToken}` })
        .send({ name: 'Sales' })
        .expect(403);

      // ...but reading their own profile needs no permission at all.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set({ Authorization: `Bearer ${invitee.body.accessToken}` })
        .expect(200);
    });
  });
});
