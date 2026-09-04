import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

const RUN = Date.now().toString(36);
const ORG_NAME = `Billing ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@billing.test`;
const STAFF_EMAIL = `staff.${RUN}@billing.test`;
const PASSWORD = 'correct-horse-battery';

describe('Projects (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  /** The owner holds `project:manage`; staff is a plain employee with `time:read` only. */
  let ownerToken: string;
  let staffToken: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

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
    ownerToken = registration.body.accessToken;

    const invitation = await http()
      .post('/api/invitations')
      .set(as(ownerToken))
      .send({ email: STAFF_EMAIL, firstName: 'Sam', lastName: 'Tester' })
      .expect(201);
    const accepted = await http()
      .post('/api/invitations/accept')
      .send({ token: invitation.body.token, password: PASSWORD })
      .expect(201);
    staffToken = accepted.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('who may administer the catalog', () => {
    it('refuses a plain employee the write routes', async () => {
      await http()
        .post('/api/projects')
        .set(as(staffToken))
        .send({ name: 'Should not exist' })
        .expect(403);
    });

    it('lets a plain employee read the catalog, since they need it to book time', async () => {
      await http().get('/api/projects').set(as(staffToken)).expect(200);
    });

    it('refuses an anonymous request outright', async () => {
      await http().get('/api/projects').expect(401);
    });
  });

  describe('projects and tasks', () => {
    let projectId: string;
    let taskId: string;

    it('creates a project with a client tag and an hourly rate', async () => {
      const response = await http()
        .post('/api/projects')
        .set(as(ownerToken))
        .send({ name: 'Website Relaunch', clientName: 'Acme Corp', hourlyRate: 95 })
        .expect(201);

      projectId = response.body.id;
      expect(response.body).toMatchObject({
        name: 'Website Relaunch',
        clientName: 'Acme Corp',
        hourlyRate: 95,
        active: true,
        taskCount: 0,
      });
    });

    it('refuses a second project with the same name', async () => {
      await http()
        .post('/api/projects')
        .set(as(ownerToken))
        .send({ name: 'Website Relaunch' })
        .expect(400);
    });

    it('adds a task with its own rate override', async () => {
      const response = await http()
        .post(`/api/projects/${projectId}/tasks`)
        .set(as(ownerToken))
        .send({ name: 'Design', hourlyRate: 120 })
        .expect(201);

      taskId = response.body.id;
      expect(response.body).toMatchObject({ projectId, name: 'Design', hourlyRate: 120, active: true });
    });

    it('lists the task under the project detail', async () => {
      const response = await http().get(`/api/projects/${projectId}`).set(as(staffToken)).expect(200);

      expect(response.body.taskCount).toBe(1);
      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.tasks[0]).toMatchObject({ id: taskId, name: 'Design' });
    });

    it('retires a project rather than deleting it', async () => {
      const other = await http()
        .post('/api/projects')
        .set(as(ownerToken))
        .send({ name: 'Sunset Candidate' })
        .expect(201);

      const retired = await http()
        .delete(`/api/projects/${other.body.id}`)
        .set(as(ownerToken))
        .expect(200);
      expect(retired.body.active).toBe(false);

      const list = await http().get('/api/projects').set(as(staffToken)).expect(200);
      expect(list.body.find((project: { id: string }) => project.id === other.body.id)).toBeUndefined();

      const withInactive = await http()
        .get('/api/projects?includeInactive=true')
        .set(as(staffToken))
        .expect(200);
      expect(
        withInactive.body.find((project: { id: string }) => project.id === other.body.id).active,
      ).toBe(false);
    });
  });
});
