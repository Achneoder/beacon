import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import {
  defaultExpectedMinutes,
  targetMinutesFor,
  weekdayOf,
  type WorkScheduleSummary,
} from '@beacon/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

/**
 * Names are still run-unique, so a failed run leaving data behind is easy to read in
 * the database — the reset in `beforeAll` is what actually keeps runs from colliding.
 */
const RUN = Date.now().toString(36);
const ORG_NAME = `Clock ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@clock.test`;
const STAFF_EMAIL = `staff.${RUN}@clock.test`;
const OUTSIDER_EMAIL = `outsider.${RUN}@clock.test`;
const PASSWORD = 'correct-horse-battery';

describe('Attendance (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  /** The owner holds `attendance:approve`; the other two are plain employees. */
  let ownerToken: string;
  let staffToken: string;
  let outsiderToken: string;
  let staffId: string;
  let outsiderId: string;

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
    // Registration installs the instance and then refuses forever, so every file has to
    // start from an empty database. Files run one at a time — see vitest.config.e2e.ts.
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

    const people = await http().get('/api/users').set(as(ownerToken)).expect(200);
    staffId = people.body.find((person: { email: string }) => person.email === STAFF_EMAIL).id;
    outsiderId = people.body.find((person: { email: string }) => person.email === OUTSIDER_EMAIL).id;
  });

  afterAll(async () => {
    // Nothing to tear down: the next file resets the database before it installs.
    await app?.close();
  });

  describe('the clock', () => {
    it('starts clocked out with nothing on the timeline', async () => {
      const today = await http().get('/api/attendance/me/today').set(as(staffToken)).expect(200);

      expect(today.body).toMatchObject({ state: 'out', since: null, workedMinutes: 0 });
      expect(today.body.segments).toEqual([]);
      // A user with no schedule of their own measures against a full-time default —
      // which is eight hours on a weekday and none at the weekend. Hard-coding 480
      // made this spec fail every Saturday and Sunday, so the expectation is derived
      // from the same shared table the API answers from.
      expect(today.body.targetMinutes).toBe(
        targetMinutesFor(
          { expectedMinutes: defaultExpectedMinutes(40 * 60) } as WorkScheduleSummary,
          weekdayOf(today.body.date),
        ),
      );
    });

    it('clocks in, and reports the instant the browser should tick from', async () => {
      const response = await http()
        .post('/api/attendance/clock-in')
        .set(as(staffToken))
        .send({ source: 'web' })
        .expect(201);

      expect(response.body.state).toBe('in');
      expect(response.body.since).not.toBeNull();
      expect(response.body.segments).toHaveLength(1);
      expect(response.body.segments[0]).toMatchObject({ kind: 'work', endedAt: null });
    });

    it('refuses a second open entry rather than silently closing the first', async () => {
      await http().post('/api/attendance/clock-in').set(as(staffToken)).send({}).expect(400);
    });

    it('moves into and out of the break state', async () => {
      const started = await http()
        .post('/api/attendance/breaks/start')
        .set(as(staffToken))
        .expect(201);

      expect(started.body.state).toBe('break');
      // The clock now runs from the break, not from the clock-in.
      expect(started.body.segments).toHaveLength(2);

      await http().post('/api/attendance/breaks/start').set(as(staffToken)).expect(400);

      const stopped = await http()
        .post('/api/attendance/breaks/stop')
        .set(as(staffToken))
        .expect(201);

      expect(stopped.body.state).toBe('in');
      await http().post('/api/attendance/breaks/stop').set(as(staffToken)).expect(400);
    });

    it('clocks out, closing the entry', async () => {
      const response = await http()
        .post('/api/attendance/clock-out')
        .set(as(staffToken))
        .expect(201);

      expect(response.body.state).toBe('out');
      expect(response.body.since).toBeNull();
      expect(response.body.segments[0].endedAt).not.toBeNull();
    });

    it('refuses a clock-out when nothing is running', async () => {
      await http().post('/api/attendance/clock-out').set(as(staffToken)).expect(400);
      await http().post('/api/attendance/breaks/start').set(as(staffToken)).expect(400);
    });
  });

  describe('the timesheet', () => {
    it('returns seven days, a total and the lock notice', async () => {
      const week = await http().get('/api/attendance/me/week').set(as(staffToken)).expect(200);

      expect(week.body.days).toHaveLength(7);
      expect(week.body.days[0].weekday).toBe('monday');
      expect(week.body.from < week.body.to).toBe(true);
      // The current week is still editable, and says when that stops.
      expect(week.body.locked).toBe(false);
      expect(new Date(week.body.locksAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('locks a week that is far enough in the past', async () => {
      const week = await http()
        .get('/api/attendance/me/week?offset=-3')
        .set(as(staffToken))
        .expect(200);

      expect(week.body.offset).toBe(-3);
      expect(week.body.locked).toBe(true);
    });

    it('reports the overtime cap alongside the balance', async () => {
      const week = await http().get('/api/attendance/me/week').set(as(staffToken)).expect(200);

      expect(week.body.overtime.capMinutes).toBe(2400);
      // Well inside the cap after a few minutes of testing.
      expect(week.body.overtime.overCap).toBe(false);
      expect(week.body.overtime.overCapMinutes).toBe(0);
    });
  });

  describe('corrections', () => {
    let correctionId: string;

    it('raises a request against a day that can no longer be edited', async () => {
      const response = await http()
        .post('/api/attendance/corrections')
        .set(as(staffToken))
        .send({
          kind: 'add',
          startedAt: '2026-08-10T07:00:00.000Z',
          endedAt: '2026-08-10T15:30:00.000Z',
          breakMinutes: 30,
          reason: 'Forgot to clock in on the Monday.',
        })
        .expect(201);

      correctionId = response.body.id;
      expect(response.body).toMatchObject({ kind: 'add', status: 'pending', breakMinutes: 30 });
    });

    it('rejects a span that ends before it starts', async () => {
      await http()
        .post('/api/attendance/corrections')
        .set(as(staffToken))
        .send({
          kind: 'add',
          startedAt: '2026-08-11T15:00:00.000Z',
          endedAt: '2026-08-11T07:00:00.000Z',
          reason: 'Backwards.',
        })
        .expect(400);
    });

    it('rejects an amendment that names no entry', async () => {
      await http()
        .post('/api/attendance/corrections')
        .set(as(staffToken))
        .send({
          kind: 'amend',
          startedAt: '2026-08-11T07:00:00.000Z',
          endedAt: '2026-08-11T15:00:00.000Z',
          reason: 'Nothing to amend.',
        })
        .expect(400);
    });

    it('refuses an employee the approval routes', async () => {
      await http()
        .post(`/api/attendance/corrections/${correctionId}/approve`)
        .set(as(staffToken))
        .send({})
        .expect(403);
    });

    it('approves, and writes the hours through to the timesheet', async () => {
      const decided = await http()
        .post(`/api/attendance/corrections/${correctionId}/approve`)
        .set(as(ownerToken))
        .send({ note: 'Confirmed with the badge log.' })
        .expect(201);

      expect(decided.body).toMatchObject({ status: 'approved' });
      expect(decided.body.decidedAt).not.toBeNull();

      const segments = await http()
        .get('/api/attendance?from=2026-08-10&to=2026-08-10')
        .set(as(staffToken))
        .expect(200);

      const work = segments.body.find((segment: { kind: string }) => segment.kind === 'work');
      // 8:30 clocked less the 30-minute break the request stated.
      expect(work).toMatchObject({ source: 'manual', durationMinutes: 510 });
      expect(segments.body.some((segment: { kind: string }) => segment.kind === 'break')).toBe(true);
    });

    it('will not decide the same request twice', async () => {
      await http()
        .post(`/api/attendance/corrections/${correctionId}/reject`)
        .set(as(ownerToken))
        .send({})
        .expect(400);
    });
  });

  describe('who may read whom', () => {
    it('refuses an employee a colleague they do not manage', async () => {
      await http().get(`/api/attendance?userId=${outsiderId}`).set(as(staffToken)).expect(403);
    });

    it('always allows a person their own record', async () => {
      await http().get(`/api/attendance?userId=${outsiderId}`).set(as(outsiderToken)).expect(200);
    });

    it('lets an approver read anyone in the organization', async () => {
      await http().get(`/api/attendance?userId=${staffId}`).set(as(ownerToken)).expect(200);
    });

    it('refuses an anonymous request outright', async () => {
      await http().get('/api/attendance/me/today').expect(401);
    });
  });
});
