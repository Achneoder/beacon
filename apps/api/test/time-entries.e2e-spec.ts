import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

const RUN = Date.now().toString(36);
const ORG_NAME = `Timekeeping ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@timekeeping.test`;
const STAFF_EMAIL = `staff.${RUN}@timekeeping.test`;
const OUTSIDER_EMAIL = `outsider.${RUN}@timekeeping.test`;
const PASSWORD = 'correct-horse-battery';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Time entries (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let ownerToken: string;
  let staffToken: string;
  let outsiderToken: string;
  let projectId: string;
  let taskId: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  async function invite(email: string, firstName: string): Promise<string> {
    const invitation = await http()
      .post('/api/invitations')
      .set(as(ownerToken))
      .send({ email, firstName, lastName: 'Tester' })
      .expect(201);
    const accepted = await http()
      .post('/api/invitations/accept')
      .send({ token: invitation.body.token, password: PASSWORD })
      .expect(201);

    return accepted.body.accessToken;
  }

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

    staffToken = await invite(STAFF_EMAIL, 'Sam');
    outsiderToken = await invite(OUTSIDER_EMAIL, 'Otto');

    const project = await http()
      .post('/api/projects')
      .set(as(ownerToken))
      .send({ name: 'Consulting', clientName: 'Acme Corp', hourlyRate: 100 })
      .expect(201);
    projectId = project.body.id;

    const task = await http()
      .post(`/api/projects/${projectId}/tasks`)
      .set(as(ownerToken))
      .send({ name: 'Discovery', hourlyRate: 150 })
      .expect(201);
    taskId = task.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the timer', () => {
    it('starts nothing running', async () => {
      // 204, not a 200 with a null body — see the controller's own note on why.
      await http().get('/api/time-entries/running').set(as(staffToken)).expect(204);
    });

    it('starts a timer against a project and task, freezing the task rate', async () => {
      const response = await http()
        .post('/api/time-entries/start')
        .set(as(staffToken))
        .send({ projectId, taskId, note: 'Kickoff call' })
        .expect(201);

      expect(response.body).toMatchObject({
        projectId,
        taskId,
        billable: true,
        rateAtEntry: 150,
        durationMinutes: null,
        amount: null,
        source: 'timer',
      });
      expect(response.body.startedAt).not.toBeNull();
      expect(response.body.endedAt).toBeNull();
    });

    it('refuses a second running timer', async () => {
      await http()
        .post('/api/time-entries/start')
        .set(as(staffToken))
        .send({ projectId })
        .expect(400);
    });

    it('reports the running timer', async () => {
      const running = await http().get('/api/time-entries/running').set(as(staffToken)).expect(200);
      expect(running.body).not.toBeNull();
      expect(running.body.projectId).toBe(projectId);
    });

    it('stops the timer, freezing the duration and the amount', async () => {
      await pause(1_200);

      const running = await http().get('/api/time-entries/running').set(as(staffToken)).expect(200);
      const stopped = await http()
        .post(`/api/time-entries/${running.body.id}/stop`)
        .set(as(staffToken))
        .expect(201);

      expect(stopped.body.endedAt).not.toBeNull();
      expect(stopped.body.durationMinutes).toBeGreaterThanOrEqual(0);
      // rateAtEntry (150) × 0 minutes rounds to 0 — the point is that `amount` is set
      // once the duration is known, not that it is large after one second of testing.
      expect(stopped.body.amount).not.toBeNull();
      expect(stopped.body.amount).toBeCloseTo((150 * stopped.body.durationMinutes) / 60, 2);
    });

    it('refuses stopping a timer that is not running', async () => {
      await http().get('/api/time-entries/running').set(as(staffToken)).expect(204);

      const list = await http().get('/api/time-entries').set(as(staffToken)).expect(200);
      const stoppedId = list.body[0].id;

      await http().post(`/api/time-entries/${stoppedId}/stop`).set(as(staffToken)).expect(400);
    });

    it('allows a fresh timer to start again once the previous one is stopped', async () => {
      await http().post('/api/time-entries/start').set(as(staffToken)).send({ projectId }).expect(201);
      const running = await http().get('/api/time-entries/running').set(as(staffToken)).expect(200);
      await http().post(`/api/time-entries/${running.body.id}/stop`).set(as(staffToken)).expect(201);
    });
  });

  describe('manual entries', () => {
    it('books a plain duration', async () => {
      const response = await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: '2026-08-20', durationMinutes: 90, note: 'Email thread' })
        .expect(201);

      expect(response.body).toMatchObject({
        projectId,
        taskId: null,
        localDate: '2026-08-20',
        durationMinutes: 90,
        rateAtEntry: 100,
        amount: 150,
        source: 'manual',
      });
    });

    it('books a start/end pair, computing the duration', async () => {
      const response = await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({
          projectId,
          taskId,
          localDate: '2026-08-21',
          startedAt: '2026-08-21T09:00:00.000Z',
          endedAt: '2026-08-21T10:30:00.000Z',
        })
        .expect(201);

      expect(response.body).toMatchObject({ durationMinutes: 90, rateAtEntry: 150, amount: 225 });
    });

    it('refuses both a duration and a start/end pair', async () => {
      await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({
          projectId,
          localDate: '2026-08-22',
          durationMinutes: 30,
          startedAt: '2026-08-22T09:00:00.000Z',
          endedAt: '2026-08-22T09:30:00.000Z',
        })
        .expect(400);
    });

    it('refuses neither a duration nor a start/end pair', async () => {
      await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: '2026-08-22' })
        .expect(400);
    });

    it('marks a booking non-billable, and freezes no amount for it', async () => {
      const response = await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: '2026-08-23', durationMinutes: 60, billable: false })
        .expect(201);

      expect(response.body).toMatchObject({ billable: false, amount: null, rateAtEntry: 100 });
    });

    it('refuses booking against a retired project', async () => {
      const retired = await http()
        .post('/api/projects')
        .set(as(ownerToken))
        .send({ name: 'About to retire' })
        .expect(201);
      await http().delete(`/api/projects/${retired.body.id}`).set(as(ownerToken)).expect(200);

      await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId: retired.body.id, localDate: '2026-08-23', durationMinutes: 30 })
        .expect(400);
    });
  });

  describe('a rate change never rewrites a past booking', () => {
    it('keeps an already-booked entry at the rate it was frozen with', async () => {
      const booked = await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: '2026-08-24', durationMinutes: 60 })
        .expect(201);
      expect(booked.body).toMatchObject({ rateAtEntry: 100, amount: 100 });

      await http()
        .patch(`/api/projects/${projectId}`)
        .set(as(ownerToken))
        .send({ hourlyRate: 200 })
        .expect(200);

      const entries = await http().get('/api/time-entries?from=2026-08-24&to=2026-08-24').set(as(staffToken)).expect(200);
      const same = entries.body.find((entry: { id: string }) => entry.id === booked.body.id);
      expect(same).toMatchObject({ rateAtEntry: 100, amount: 100 });

      const fresh = await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: '2026-08-24', durationMinutes: 60, note: 'after the rate change' })
        .expect(201);
      expect(fresh.body).toMatchObject({ rateAtEntry: 200, amount: 200 });
    });
  });

  describe('ownership', () => {
    let entryId: string;

    it('creates an entry for the outsider', async () => {
      const response = await http()
        .post('/api/time-entries')
        .set(as(outsiderToken))
        .send({ projectId, localDate: '2026-08-25', durationMinutes: 30 })
        .expect(201);
      entryId = response.body.id;
    });

    it('refuses another user editing or deleting it', async () => {
      await http()
        .patch(`/api/time-entries/${entryId}`)
        .set(as(staffToken))
        .send({ note: 'not mine to change' })
        .expect(404);

      await http().delete(`/api/time-entries/${entryId}`).set(as(staffToken)).expect(404);
    });

    it('lets the owner delete their own entry', async () => {
      await http().delete(`/api/time-entries/${entryId}`).set(as(outsiderToken)).expect(204);
    });
  });

  describe('permissions', () => {
    it('refuses an anonymous request outright', async () => {
      await http().get('/api/time-entries').expect(401);
    });
  });
});
