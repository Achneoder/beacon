import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { DEFAULT_ROLES, type Permission, type RoleSummary } from '@beacon/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { OrganizationService } from '../src/modules/organizations/organization.service.js';
import { Role } from '../src/modules/roles/role.entity.js';
import { resetInstance } from './instance.js';

const RUN = Date.now().toString(36);
const ORG_NAME = `Roles ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@roles.test`;
const OPS_EMAIL = `ops.${RUN}@roles.test`;
const HOLDER_EMAIL = `holder.${RUN}@roles.test`;
const PASSWORD = 'correct-horse-battery';

/**
 * The role editor, end to end.
 *
 * The interesting half is not the CRUD — it is that `organization:manage`, the
 * permission that reaches these routes, must not become a way to mint authority its
 * holder does not have. That needs a caller who holds it and little else, so the suite
 * builds one: an `ops` role carrying exactly `organization:read` and
 * `organization:manage`, and a real signed-in account wearing it.
 */
describe('Roles (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let owner: string;
  /** Holds organization:manage and nothing else worth having. */
  let ops: string;
  let opsRoleId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const asOps = () => ({ Authorization: `Bearer ${ops}` });

  const listRoles = async (token = owner): Promise<RoleSummary[]> =>
    (await http().get('/api/roles').set({ Authorization: `Bearer ${token}` }).expect(200)).body;

  const roleNamed = async (key: string): Promise<RoleSummary> =>
    (await listRoles()).find((role) => role.key === key)!;

  /** Invites somebody with the given roles and accepts, returning their access token. */
  const accountWith = async (email: string, roleIds: string[]): Promise<string> => {
    const invitation = await http()
      .post('/api/invitations')
      .set(auth())
      .send({ email, firstName: 'Test', lastName: 'Person', roleIds })
      .expect(201);

    const accepted = await http()
      .post('/api/invitations/accept')
      .send({ token: invitation.body.token, password: PASSWORD })
      .expect(201);

    return accepted.body.accessToken;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    orm = app.get(MikroORM);
    await resetInstance(orm);

    const registration = await http()
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

    const opsRole = await http()
      .post('/api/roles')
      .set(auth())
      .send({ name: 'Ops', permissions: ['organization:read', 'organization:manage'] })
      .expect(201);

    opsRoleId = opsRole.body.id;
    ops = await accountWith(OPS_EMAIL, [opsRoleId]);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('listing', () => {
    it('returns the four built-in roles plus whatever the organization added', async () => {
      const roles = await listRoles();

      expect(roles.map((role) => role.key)).toEqual(
        expect.arrayContaining([...Object.keys(DEFAULT_ROLES), 'ops']),
      );
      expect(await roleNamed('owner')).toMatchObject({ isSystem: true, customized: false });
      expect(await roleNamed('ops')).toMatchObject({ isSystem: false, customized: false });
    });

    it('counts the people and pending invitations holding each role', async () => {
      // The owner wears `owner`; the ops account was invited and has accepted, so it
      // counts as a person rather than an invitation.
      expect((await roleNamed('owner')).memberCount).toBe(1);
      expect((await roleNamed('ops')).memberCount).toBe(1);
      expect((await roleNamed('manager')).memberCount).toBe(0);
    });

    it('refuses a caller with no organization:read', async () => {
      const employee = await accountWith(`nobody.${RUN}@roles.test`, [
        (await roleNamed('employee')).id,
      ]);

      await http().get('/api/roles').set({ Authorization: `Bearer ${employee}` }).expect(403);
    });
  });

  describe('creating', () => {
    it('derives a stable key from the name and stores the permissions', async () => {
      const created = await http()
        .post('/api/roles')
        .set(auth())
        .send({ name: 'Payroll Clerk', permissions: ['report:read', 'document:read'] })
        .expect(201);

      expect(created.body).toMatchObject({
        key: 'payroll-clerk',
        name: 'Payroll Clerk',
        isSystem: false,
        customized: false,
        memberCount: 0,
      });
      expect(created.body.permissions).toEqual(['report:read', 'document:read']);
    });

    it('refuses a second role with the same name', async () => {
      await http()
        .post('/api/roles')
        .set(auth())
        .send({ name: 'Payroll Clerk', permissions: [] })
        .expect(409);
    });

    it('refuses a permission that is not in the union', async () => {
      await http()
        .post('/api/roles')
        .set(auth())
        .send({ name: 'Impostor', permissions: ['organization:destroy'] })
        .expect(400);
    });

    it('refuses a caller without organization:manage', async () => {
      const admin = await accountWith(`admin.${RUN}@roles.test`, [(await roleNamed('admin')).id]);

      await http()
        .post('/api/roles')
        .set({ Authorization: `Bearer ${admin}` })
        .send({ name: 'Admins Own', permissions: [] })
        .expect(403);
    });

    /**
     * The escalation this feature could have introduced. `ops` holds
     * `organization:manage` and reaches these routes, but not `document:manage` — so
     * it may not package `document:manage` into a role and then wear it.
     */
    it('refuses a permission the caller does not hold themselves', async () => {
      const refused = await http()
        .post('/api/roles')
        .set(asOps())
        .send({ name: 'Everything', permissions: ['document:manage'] })
        .expect(403);

      expect(refused.body.message).toMatch(/document:manage/);
    });

    it('lets that same caller create a role within their own authority', async () => {
      await http()
        .post('/api/roles')
        .set(asOps())
        .send({ name: 'Settings Reader', permissions: ['organization:read'] })
        .expect(201);
    });

    /**
     * The self-service exemption, which a plain subset rule would break: `ops` holds
     * none of these, and an administrator still has to be able to define an ordinary
     * employee's role. Every one of them is scoped to the holder's own record in code.
     */
    it('lets a caller hand out the self-service permissions they lack', async () => {
      await http()
        .post('/api/roles')
        .set(asOps())
        .send({
          name: 'Newcomer',
          permissions: ['attendance:write', 'holiday:request', 'document:write'],
        })
        .expect(201);
    });
  });

  describe('editing', () => {
    it('replaces the permission list and renames a custom role', async () => {
      const role = await roleNamed('payroll-clerk');

      const updated = await http()
        .patch(`/api/roles/${role.id}`)
        .set(auth())
        .send({ name: 'Payroll', permissions: ['report:read'] })
        .expect(200);

      expect(updated.body).toMatchObject({ name: 'Payroll', key: 'payroll-clerk' });
      expect(updated.body.permissions).toEqual(['report:read']);
    });

    it('refuses to rewrite a role holding authority the caller lacks', async () => {
      // `admin` carries document:manage; `ops` does not, so the role is not theirs to
      // rewrite — not even to strip something out of it.
      const refused = await http()
        .patch(`/api/roles/${(await roleNamed('admin')).id}`)
        .set(asOps())
        .send({ permissions: ['organization:read'] })
        .expect(403);

      expect(refused.body.message).toMatch(/you may not edit/);
    });

    it('refuses the owner role outright, even to its own holder', async () => {
      await http()
        .patch(`/api/roles/${(await roleNamed('owner')).id}`)
        .set(auth())
        .send({ permissions: ['organization:manage'] })
        .expect(403);
    });

    it('refuses to rename a built-in role', async () => {
      await http()
        .patch(`/api/roles/${(await roleNamed('manager')).id}`)
        .set(auth())
        .send({ name: 'Team Lead' })
        .expect(403);
    });

    /**
     * The reason `Role.customized` exists. `reconcileSystemRoles` rewrites every
     * unedited system role from `DEFAULT_ROLES` at boot, so an organization's own edit
     * would not survive the next restart without the flag — asserted here by running
     * the boot hook again rather than by trusting the column.
     */
    it('keeps an edited built-in role across a restart', async () => {
      const manager = await roleNamed('manager');
      const trimmed = manager.permissions.filter(
        (permission) => permission !== 'report:read',
      ) as Permission[];

      const updated = await http()
        .patch(`/api/roles/${manager.id}`)
        .set(auth())
        .send({ permissions: trimmed })
        .expect(200);

      expect(updated.body.customized).toBe(true);

      await app.get(OrganizationService).onModuleInit();

      const after = await roleNamed('manager');
      expect(after.permissions).not.toContain('report:read');
      expect(after.customized).toBe(true);
    });

    it('still re-syncs a built-in role nobody has touched', async () => {
      // The behaviour the flag must not have broken: a permission edited out behind the
      // API's back is restored at boot for a role still marked as the shipped one.
      const em = orm.em.fork();
      const employee = await em.findOneOrFail(Role, { key: 'employee' });
      employee.permissions = ['attendance:read'];
      await em.flush();

      await app.get(OrganizationService).onModuleInit();

      expect((await roleNamed('employee')).permissions).toEqual([...DEFAULT_ROLES.employee]);
    });

    it('takes effect on the holder as soon as their token is reissued', async () => {
      // The access token carries the permission union, so a role change is invisible
      // until the session refreshes — this is the half a service test cannot show.
      const settingsReader = await roleNamed('settings-reader');
      const holder = await accountWith(HOLDER_EMAIL, [settingsReader.id]);

      await http().get('/api/reports/attendance/summary').set({ Authorization: `Bearer ${holder}` }).expect(403);

      await http()
        .patch(`/api/roles/${settingsReader.id}`)
        .set(auth())
        .send({ permissions: ['organization:read', 'report:read'] })
        .expect(200);

      const reissued = await http()
        .post('/api/auth/login')
        .send({ email: HOLDER_EMAIL, password: PASSWORD })
        .expect(200);

      await http()
        .get('/api/reports/attendance/summary')
        .set({ Authorization: `Bearer ${reissued.body.accessToken}` })
        .expect(200);
    });
  });

  describe('deleting', () => {
    it('refuses a built-in role', async () => {
      await http().delete(`/api/roles/${(await roleNamed('employee')).id}`).set(auth()).expect(403);
    });

    it('refuses while somebody still holds it', async () => {
      // Deleting would cascade through `user_roles` and take their authority with it,
      // invisibly — so the holder has to be reassigned first.
      await http().delete(`/api/roles/${opsRoleId}`).set(auth()).expect(409);
    });

    it('refuses while a pending invitation still carries it', async () => {
      const doomed = await http()
        .post('/api/roles')
        .set(auth())
        .send({ name: 'Doomed', permissions: [] })
        .expect(201);

      await http()
        .post('/api/invitations')
        .set(auth())
        .send({
          email: `pending.${RUN}@roles.test`,
          firstName: 'Pending',
          lastName: 'Person',
          roleIds: [doomed.body.id],
        })
        .expect(201);

      expect((await roleNamed('doomed')).memberCount).toBe(1);
      await http().delete(`/api/roles/${doomed.body.id}`).set(auth()).expect(409);
    });

    it('deletes a custom role nobody holds', async () => {
      const spare = await http()
        .post('/api/roles')
        .set(auth())
        .send({ name: 'Spare', permissions: ['report:read'] })
        .expect(201);

      await http().delete(`/api/roles/${spare.body.id}`).set(auth()).expect(204);

      expect((await listRoles()).some((role) => role.key === 'spare')).toBe(false);
    });

    it('404s on a role from no organization at all', async () => {
      await http()
        .delete('/api/roles/00000000-0000-4000-8000-000000000000')
        .set(auth())
        .expect(404);
    });
  });
});
