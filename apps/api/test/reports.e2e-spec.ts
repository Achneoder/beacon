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
const ORG_NAME = `Reports ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@reports.test`;
const STAFF_EMAIL = `staff.${RUN}@reports.test`;
const OTHER_EMAIL = `other.${RUN}@reports.test`;
const PASSWORD = 'correct-horse-battery';

/**
 * A week in the past, so nothing here collides with a clock the suite is running now
 * and so the days are known weekdays. 2026-08-03 is a Monday.
 */
const MONDAY = '2026-08-03';
const TUESDAY = '2026-08-04';
const FRIDAY = '2026-08-07';
const FULL_DAY = 480;

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  /** The owner holds every permission, `report:read` among them. */
  let ownerToken: string;
  /** A plain employee: no `report:read` at all. */
  let staffToken: string;
  let otherToken: string;
  let staffId: string;
  let departmentId: string;

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

  /**
   * A day of history at a date the clock cannot reach.
   *
   * Corrections are the only way in — which is the honest path anyway: this is
   * exactly how a forgotten clock-in becomes hours on a real timesheet, and it
   * exercises the same write the report has to read back.
   */
  async function recordDay(
    token: string,
    date: string,
    hours: { from: string; to: string; breakMinutes?: number },
  ): Promise<void> {
    const correction = await http()
      .post('/api/attendance/corrections')
      .set(as(token))
      .send({
        kind: 'add',
        startedAt: `${date}T${hours.from}:00.000Z`,
        endedAt: `${date}T${hours.to}:00.000Z`,
        breakMinutes: hours.breakMinutes ?? 0,
        reason: 'Recorded for the report.',
      })
      .expect(201);

    await http()
      .post(`/api/attendance/corrections/${correction.body.id}/approve`)
      .set(as(ownerToken))
      .send({})
      .expect(201);
  }

  const summary = async (token: string, query = `from=${MONDAY}&to=${FRIDAY}`) =>
    (await http().get(`/api/reports/attendance/summary?${query}`).set(as(token)).expect(200)).body;

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
    otherToken = await invite(OTHER_EMAIL, 'Otto');

    const people = await http().get('/api/users').set(as(ownerToken)).expect(200);
    staffId = people.body.find((person: { email: string }) => person.email === STAFF_EMAIL).id;

    const department = await http()
      .post('/api/departments')
      .set(as(ownerToken))
      .send({ name: 'Engineering' })
      .expect(201);
    departmentId = department.body.id;

    await http()
      .patch(`/api/users/${staffId}`)
      .set(as(ownerToken))
      .send({ departmentId })
      .expect(200);

    // Monday: a full day less a lunch break. Tuesday: a short day.
    await recordDay(staffToken, MONDAY, { from: '07:00', to: '15:30', breakMinutes: 30 });
    await recordDay(staffToken, TUESDAY, { from: '09:00', to: '13:00' });
  });

  afterAll(async () => {
    // Nothing to tear down: the next file resets the database before it installs.
    await app?.close();
  });

  describe('permissions', () => {
    it.each([
      `/api/reports/attendance/summary?from=${MONDAY}&to=${FRIDAY}`,
      '/api/reports/absences/summary',
      `/api/reports/attendance/export?from=${MONDAY}&to=${FRIDAY}`,
      `/api/reports/time/summary?from=${MONDAY}&to=${FRIDAY}`,
    ])('refuses %s to an employee, who holds no report:read', async (path) => {
      await http().get(path).set(as(staffToken)).expect(403);
    });

    it('refuses an unauthenticated caller before it refuses the permission', async () => {
      await http().get('/api/reports/absences/summary').expect(401);
    });
  });

  describe('the attendance summary', () => {
    it('reports worked, expected and balance per person over the range', async () => {
      const body = await summary(ownerToken);

      expect(body).toMatchObject({
        groupBy: 'user',
        range: { from: MONDAY, to: FRIDAY },
      });

      const sam = body.rows.find((row: { subjectName: string }) => row.subjectName === 'Sam Tester');
      // 8:30 clocked less a 30-minute break, then four hours.
      expect(sam).toMatchObject({
        workedMinutes: 480 + 240,
        breakMinutes: 30,
        expectedMinutes: 5 * FULL_DAY,
        daysWorked: 2,
        headcount: 1,
      });
      expect(sam.balanceMinutes).toBe(720 - 5 * FULL_DAY);
    });

    it('includes a person who never clocked at all, at their full target', async () => {
      // The reason the report reads the entries rather than the AttendanceDay ledger:
      // Otto has no ledger row for any of these days, and dropping him would report
      // the organization as far closer to target than it is.
      const body = await summary(ownerToken);
      const otto = body.rows.find((row: { subjectName: string }) => row.subjectName === 'Otto Tester');

      expect(otto).toMatchObject({
        workedMinutes: 0,
        expectedMinutes: 5 * FULL_DAY,
        balanceMinutes: -5 * FULL_DAY,
        daysWorked: 0,
      });
    });

    it('keeps worked + credited - expected equal to the balance on every row', async () => {
      const body = await summary(ownerToken);

      for (const row of [...body.rows, body.total]) {
        expect(row.workedMinutes + row.creditedMinutes - row.expectedMinutes).toBe(
          row.balanceMinutes,
        );
      }
    });

    it('rolls the same figures up by department, unassigned included', async () => {
      const byUser = await summary(ownerToken);
      const byDepartment = await summary(ownerToken, `from=${MONDAY}&to=${FRIDAY}&groupBy=department`);

      expect(byDepartment.groupBy).toBe('department');
      expect(byDepartment.rows.map((row: { subjectName: string }) => row.subjectName)).toEqual([
        'Engineering',
        'Unassigned',
      ]);
      // The grouping changes the rows, never the totals.
      expect(byDepartment.total.workedMinutes).toBe(byUser.total.workedMinutes);
      expect(byDepartment.total.expectedMinutes).toBe(byUser.total.expectedMinutes);
      expect(byDepartment.total.headcount).toBe(byUser.total.headcount);

      const engineering = byDepartment.rows[0];
      expect(engineering).toMatchObject({ subjectId: departmentId, headcount: 1, workedMinutes: 720 });
      // A lifetime overtime bank means nothing summed across people.
      expect(engineering.overtime).toBeNull();
    });

    it('reports the overtime bank beside the rows, whatever the grouping', async () => {
      const byUser = await summary(ownerToken);
      const byDepartment = await summary(ownerToken, `from=${MONDAY}&to=${FRIDAY}&groupBy=department`);

      expect(byUser.overtimeMinutes).toBe(byDepartment.overtimeMinutes);
      expect(byUser.headcount).toBe(3);
      expect(byUser.overCapCount).toBe(0);
    });

    it('refuses a grouping it does not have', async () => {
      await http()
        .get('/api/reports/attendance/summary?groupBy=team')
        .set(as(ownerToken))
        .expect(400);
    });

    it('refuses a date that is not YYYY-MM-DD', async () => {
      await http()
        .get('/api/reports/attendance/summary?from=last-tuesday')
        .set(as(ownerToken))
        .expect(400);
    });

    it('defaults the range to the month containing today', async () => {
      const body = await summary(ownerToken, '');

      expect(body.range.from).toBe(`${body.range.to.slice(0, 7)}-01`);
    });
  });

  describe('the billable summary', () => {
    let projectId: string;
    let taskId: string;

    beforeAll(async () => {
      const project = await http()
        .post('/api/projects')
        .set(as(ownerToken))
        .send({ name: 'Migration', clientName: 'Acme Corp', hourlyRate: 100 })
        .expect(201);
      projectId = project.body.id;

      const task = await http()
        .post(`/api/projects/${projectId}/tasks`)
        .set(as(ownerToken))
        .send({ name: 'Cutover', hourlyRate: 150 })
        .expect(201);
      taskId = task.body.id;

      // 90 minutes at the task's rate, 60 minutes at the project's own rate, and one
      // non-billable hour that must contribute minutes but never an amount.
      await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, taskId, localDate: MONDAY, durationMinutes: 90 })
        .expect(201);
      await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: TUESDAY, durationMinutes: 60 })
        .expect(201);
      await http()
        .post('/api/time-entries')
        .set(as(staffToken))
        .send({ projectId, localDate: TUESDAY, durationMinutes: 60, billable: false })
        .expect(201);
    });

    const billable = async (query: string) =>
      (await http().get(`/api/reports/time/summary?${query}`).set(as(ownerToken)).expect(200)).body;

    it('sums minutes and the frozen amount per project by default', async () => {
      const body = await billable(`from=${MONDAY}&to=${FRIDAY}`);

      expect(body.groupBy).toBe('project');
      const row = body.rows.find((entry: { key: string }) => entry.key === projectId);
      expect(row).toMatchObject({
        label: 'Migration',
        minutes: 90 + 60 + 60,
        billableMinutes: 90 + 60,
        // 150/h × 90min + 100/h × 60min = 225 + 100
        amount: 225 + 100,
        entryCount: 3,
      });
    });

    it('groups by task, task-less minutes in their own bucket', async () => {
      const body = await billable(`from=${MONDAY}&to=${FRIDAY}&groupBy=task`);

      const cutover = body.rows.find((row: { key: string }) => row.key === taskId);
      expect(cutover).toMatchObject({ label: 'Cutover', minutes: 90, amount: 225 });

      const noTask = body.rows.find((row: { key: string | null }) => row.key === null);
      expect(noTask).toMatchObject({ label: 'No task', minutes: 120 });
    });

    it('groups by the free-text client tag', async () => {
      const body = await billable(`from=${MONDAY}&to=${FRIDAY}&groupBy=client`);

      const acme = body.rows.find((row: { key: string }) => row.key === 'Acme Corp');
      expect(acme).toMatchObject({ minutes: 90 + 60 + 60, amount: 225 + 100 });
    });

    it('groups by user', async () => {
      const body = await billable(`from=${MONDAY}&to=${FRIDAY}&groupBy=user`);

      const sam = body.rows.find((row: { label: string }) => row.label === 'Sam Tester');
      expect(sam).toMatchObject({ minutes: 90 + 60 + 60 });
    });

    it('filters to a single project', async () => {
      const body = await billable(`from=${MONDAY}&to=${FRIDAY}&projectId=${projectId}`);

      expect(body.rows).toHaveLength(1);
      expect(body.total.entryCount).toBe(3);
    });

    it('never lets a later rate change move an already-frozen amount', async () => {
      const before = await billable(`from=${MONDAY}&to=${FRIDAY}&projectId=${projectId}`);

      await http().patch(`/api/projects/${projectId}`).set(as(ownerToken)).send({ hourlyRate: 999 }).expect(200);

      const after = await billable(`from=${MONDAY}&to=${FRIDAY}&projectId=${projectId}`);
      expect(after.total.amount).toBe(before.total.amount);
    });

    it('refuses a grouping it does not have', async () => {
      await http().get('/api/reports/time/summary?groupBy=department').set(as(ownerToken)).expect(400);
    });
  });

  describe('the absence summary', () => {
    let vacationTypeId: string;

    beforeAll(async () => {
      const types = await http().get('/api/absences/types').set(as(ownerToken)).expect(200);
      vacationTypeId = types.body.find((type: { key: string }) => type.key === 'vacation').id;
    });

    it('agrees with the balance the person reads on their own screen', async () => {
      const year = Number(MONDAY.slice(0, 4));
      const own = await http()
        .get(`/api/absences/balances/me?year=${year}`)
        .set(as(staffToken))
        .expect(200);

      const report = await http()
        .get(`/api/reports/absences/summary?year=${year}`)
        .set(as(ownerToken))
        .expect(200);

      const sam = report.body.rows.find((row: { userId: string }) => row.userId === staffId);
      expect(sam).toMatchObject({
        userName: 'Sam Tester',
        departmentName: 'Engineering',
        entitlementDays: own.body.entitlementDays,
        takenDays: own.body.takenDays,
        remainingDays: own.body.remainingDays,
      });
    });

    it('moves with an approved absence, and sums the columns', async () => {
      const year = Number(MONDAY.slice(0, 4));
      const before = await http()
        .get(`/api/reports/absences/summary?year=${year}`)
        .set(as(ownerToken))
        .expect(200);

      const created = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({
          typeId: vacationTypeId,
          startsOn: '2026-09-07',
          endsOn: '2026-09-11',
          note: 'A week off.',
        })
        .expect(201);

      await http()
        .post(`/api/absences/${created.body.id}/approve`)
        .set(as(ownerToken))
        .send({})
        .expect(201);

      const after = await http()
        .get(`/api/reports/absences/summary?year=${year}`)
        .set(as(ownerToken))
        .expect(200);

      expect(after.body.total.takenDays).toBe(before.body.total.takenDays + 5);
      expect(after.body.total.remainingDays).toBe(before.body.total.remainingDays - 5);
      expect(after.body.total.entitlementDays).toBe(
        after.body.rows.reduce((sum: number, row: { entitlementDays: number }) => sum + row.entitlementDays, 0),
      );
    });

    it('reports a default quota for someone who has never had one written', async () => {
      // A report must not create the row a screen would. Otto has never asked for a
      // day off, so his quota exists only as a default until someone sets one.
      const report = await http()
        .get('/api/reports/absences/summary?year=2031')
        .set(as(ownerToken))
        .expect(200);

      expect(report.body.year).toBe(2031);
      expect(report.body.rows).toHaveLength(3);
      for (const row of report.body.rows) {
        expect(row).toMatchObject({ takenDays: 0, pendingDays: 0, entitlementDays: 30 });
      }

      // And it is still not there afterwards — reading twice must not have written.
      const again = await http()
        .get('/api/reports/absences/summary?year=2031')
        .set(as(ownerToken))
        .expect(200);
      expect(again.body.rows).toEqual(report.body.rows);
    });

    it('refuses a year that is not one', async () => {
      await http()
        .get('/api/reports/absences/summary?year=twenty-six')
        .set(as(ownerToken))
        .expect(400);
    });
  });

  describe('the CSV export', () => {
    it('streams a UTF-8 file with a header and one row per person per day', async () => {
      const response = await http()
        .get(`/api/reports/attendance/export?from=${MONDAY}&to=${FRIDAY}`)
        .set(as(ownerToken))
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain(
        `filename="beacon-attendance-${MONDAY}-to-${FRIDAY}.csv"`,
      );

      const text = response.text;
      // The BOM, so Excel reads the file as UTF-8 rather than the host code page.
      expect(text.startsWith('\uFEFF')).toBe(true);

      const lines = text.replace('\uFEFF', '').trim().split('\r\n');
      expect(lines[0]).toBe(
        'employee_number,name,email,department,date,worked_hours,break_hours,expected_hours,credited_hours,balance_hours,absence,holiday',
      );
      // Three people over five days.
      expect(lines).toHaveLength(1 + 3 * 5);

      const monday = lines.find((line) => line.includes('Sam Tester') && line.includes(MONDAY));
      // Decimal hours, not H:MM — the column exists to be summed.
      expect(monday).toContain(',8.00,0.50,8.00,0.00,0.00,');
    });

    it('serves only csv, and names the formats it does not have', async () => {
      await http()
        .get(`/api/reports/attendance/export?from=${MONDAY}&to=${FRIDAY}&format=xlsx`)
        .set(as(ownerToken))
        .expect(400);
    });

    it('refuses the export to an employee too', async () => {
      await http()
        .get(`/api/reports/attendance/export?from=${MONDAY}&to=${FRIDAY}`)
        .set(as(otherToken))
        .expect(403);
    });
  });
});
