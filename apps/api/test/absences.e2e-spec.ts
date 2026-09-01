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
const ORG_NAME = `Leave ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@leave.test`;
const STAFF_EMAIL = `staff.${RUN}@leave.test`;
const OTHER_EMAIL = `other.${RUN}@leave.test`;
const BOSS_EMAIL = `boss.${RUN}@leave.test`;
const PASSWORD = 'correct-horse-battery';

function iso(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function shift(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);

  return iso(at);
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * Ranges are anchored to the Monday of the current week so every one of them is a
 * real working week whatever day the suite happens to run on. Each block gets a week
 * of its own — an overlapping range is refused, which is itself under test below.
 */
const TODAY = iso(new Date());
const THIS_MONDAY = shift(TODAY, -((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7));

/** One person's absences across a calendar payload, in no particular order. */
interface CalendarAbsence {
  userId: string;
  typeKey: string;
  note: string | null;
  decisionNote: string | null;
  documentId: string | null;
  documentTitle: string | null;
}

function absencesOf(calendar: { days: { absences: CalendarAbsence[] }[] }, userId: string) {
  return calendar.days
    .flatMap((day) => day.absences)
    .filter((absence) => absence.userId === userId);
}

describe('Absence (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  /** The owner holds `holiday:approve`; the other two are plain employees. */
  let ownerToken: string;
  let staffToken: string;
  let otherToken: string;
  let staffId: string;
  let otherId: string;
  let vacationTypeId: string;
  let homeOfficeTypeId: string;
  let overtimeTypeId: string;
  /** A manager: holds `holiday:approve`, and — per DEFAULT_ROLES — not `holiday:request`. */
  let managerToken: string;

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

  /** The running overtime bank, as the timesheet reports it. */
  async function overtimeFor(token: string): Promise<number> {
    const week = await http().get('/api/attendance/me/week').set(as(token)).expect(200);

    return week.body.overtime.balanceMinutes as number;
  }

  async function balanceFor(token: string, year: number) {
    const response = await http()
      .get(`/api/absences/balances/me?year=${year}`)
      .set(as(token))
      .expect(200);

    return response.body as {
      entitlementDays: number;
      takenDays: number;
      pendingDays: number;
      remainingDays: number;
    };
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
    otherToken = await invite(OTHER_EMAIL, 'Otto');

    const people = await http().get('/api/users').set(as(ownerToken)).expect(200);
    staffId = people.body.find((person: { email: string }) => person.email === STAFF_EMAIL).id;
    otherId = people.body.find((person: { email: string }) => person.email === OTHER_EMAIL).id;
  });

  afterAll(async () => {
    // Nothing to tear down: the next file resets the database before it installs.
    await app?.close();
  });

  describe('absence types', () => {
    it('seeds the nine built-in types on first read', async () => {
      const response = await http().get('/api/absences/types').set(as(staffToken)).expect(200);

      expect(response.body).toHaveLength(9);

      const vacation = response.body.find((type: { key: string }) => type.key === 'vacation');
      const homeOffice = response.body.find((type: { key: string }) => type.key === 'home-office');
      const overtime = response.body.find((type: { key: string }) => type.key === 'overtime-comp');

      // The four flags are independent: vacation spends the quota, home office is
      // still a working day that merely shows on the calendar, and time off in lieu
      // spends the overtime bank and nothing else.
      expect(vacation).toMatchObject({
        deductsFromQuota: true,
        paid: true,
        countsAsWork: false,
        deductsFromOvertime: false,
      });
      expect(homeOffice).toMatchObject({
        deductsFromQuota: false,
        paid: true,
        countsAsWork: true,
        deductsFromOvertime: false,
      });
      expect(overtime).toMatchObject({
        deductsFromQuota: false,
        paid: true,
        countsAsWork: false,
        deductsFromOvertime: true,
      });

      vacationTypeId = vacation.id;
      homeOfficeTypeId = homeOffice.id;
      overtimeTypeId = overtime.id;
    });

    it('seeds once, not once per read', async () => {
      const response = await http().get('/api/absences/types').set(as(otherToken)).expect(200);

      expect(response.body).toHaveLength(9);
    });
  });

  describe('requesting', () => {
    const from = shift(THIS_MONDAY, 14);
    const to = shift(THIS_MONDAY, 18);

    it('costs a plain working week five days', async () => {
      const response = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: vacationTypeId, startsOn: from, endsOn: to, note: 'Sailing' })
        .expect(201);

      expect(response.body).toMatchObject({
        status: 'pending',
        costDays: 5,
        workingDays: 5,
        typeKey: 'vacation',
        note: 'Sailing',
      });
    });

    it('holds the days as pending until someone decides', async () => {
      const balance = await balanceFor(staffToken, yearOf(from));

      expect(balance.pendingDays).toBe(5);
      expect(balance.takenDays).toBe(0);
      // Pending days are not yet spent — the quota only moves on approval.
      expect(balance.remainingDays).toBe(balance.entitlementDays);
    });

    it('refuses a second absence over days already spoken for', async () => {
      await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: vacationTypeId, startsOn: to, endsOn: shift(to, 3) })
        .expect(400);
    });

    it('refuses a range with no working day in it', async () => {
      const saturday = shift(THIS_MONDAY, 61);

      await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: vacationTypeId, startsOn: saturday, endsOn: shift(saturday, 1) })
        .expect(400);
    });

    it('refuses a range that runs backwards', async () => {
      await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: vacationTypeId, startsOn: shift(THIS_MONDAY, 70), endsOn: shift(THIS_MONDAY, 69) })
        .expect(400);
    });

    it('reads a single day flagged at both ends as half a day', async () => {
      const day = shift(THIS_MONDAY, 42);

      const response = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({
          typeId: vacationTypeId,
          startsOn: day,
          endsOn: day,
          halfDayStart: true,
          halfDayEnd: true,
        })
        .expect(201);

      expect(response.body.costDays).toBe(0.5);
    });

    it('will not let an employee raise an absence for someone else', async () => {
      await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({
          typeId: vacationTypeId,
          startsOn: shift(THIS_MONDAY, 84),
          endsOn: shift(THIS_MONDAY, 84),
          userId: otherId,
        })
        .expect(403);
    });
  });

  describe('public holidays', () => {
    const from = shift(THIS_MONDAY, 28);
    const wednesday = shift(from, 2);

    it('subtracts a closed day from the cost of a request raised afterwards', async () => {
      await http()
        .post('/api/public-holidays')
        .set(as(ownerToken))
        .send({ date: wednesday, name: 'Founders Day' })
        .expect(201);

      const response = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: vacationTypeId, startsOn: from, endsOn: shift(from, 4) })
        .expect(201);

      // Five weekdays, one of them the office is shut anyway.
      expect(response.body.costDays).toBe(4);
    });

    it('is not something an employee may declare', async () => {
      await http()
        .post('/api/public-holidays')
        .set(as(staffToken))
        .send({ date: shift(THIS_MONDAY, 98), name: 'Nap Day' })
        .expect(403);
    });
  });

  describe('deciding', () => {
    let requestId: string;

    it('is refused to a caller without holiday:approve', async () => {
      const mine = await http().get('/api/absences').set(as(staffToken)).expect(200);
      requestId = mine.body.find((absence: { costDays: number }) => absence.costDays === 5).id;

      await http().post(`/api/absences/${requestId}/approve`).set(as(staffToken)).send({}).expect(403);
    });

    it('commits the days to the quota once approved', async () => {
      const response = await http()
        .post(`/api/absences/${requestId}/approve`)
        .set(as(ownerToken))
        .send({ note: 'Enjoy' })
        .expect(201);

      expect(response.body).toMatchObject({ status: 'approved', decisionNote: 'Enjoy' });

      const balance = await balanceFor(staffToken, yearOf(shift(THIS_MONDAY, 14)));

      expect(balance.takenDays).toBe(5);
      expect(balance.remainingDays).toBe(balance.entitlementDays - 5);
    });

    it('will not decide the same request twice', async () => {
      await http().post(`/api/absences/${requestId}/reject`).set(as(ownerToken)).send({}).expect(400);
    });

    it('will not let an approver decide their own request', async () => {
      const own = await http()
        .post('/api/absences')
        .set(as(ownerToken))
        .send({
          typeId: vacationTypeId,
          startsOn: shift(THIS_MONDAY, 105),
          endsOn: shift(THIS_MONDAY, 105),
        })
        .expect(201);

      await http()
        .post(`/api/absences/${own.body.id}/approve`)
        .set(as(ownerToken))
        .send({})
        .expect(403);
    });
  });

  describe('time off in lieu', () => {
    // Ten weeks out, so it collides with none of the ranges above.
    const from = shift(THIS_MONDAY, 70);
    const to = shift(THIS_MONDAY, 74);
    let requestId: string;
    let bankBefore: number;
    let quotaBefore: number;

    it('costs the overtime bank, not the quota', async () => {
      bankBefore = await overtimeFor(staffToken);
      quotaBefore = (await balanceFor(staffToken, yearOf(from))).takenDays;

      const response = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: overtimeTypeId, startsOn: from, endsOn: to })
        .expect(201);

      // Five full-time days, priced in minutes off the bank and nothing off the quota.
      expect(response.body).toMatchObject({ costDays: 0, costMinutes: 5 * 480, workingDays: 5 });

      requestId = response.body.id;
    });

    it('spends nothing until the request is approved', async () => {
      expect(await overtimeFor(staffToken)).toBe(bankBefore);
    });

    it('halves a half day against the day it names', async () => {
      const day = shift(THIS_MONDAY, 77);
      const created = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: overtimeTypeId, startsOn: day, endsOn: day, halfDayStart: true })
        .expect(201);

      expect(created.body.costMinutes).toBe(240);

      await http().delete(`/api/absences/${created.body.id}`).set(as(staffToken)).expect(204);
    });

    it('debits the bank once approved and leaves the quota alone', async () => {
      await http()
        .post(`/api/absences/${requestId}/approve`)
        .set(as(ownerToken))
        .send({})
        .expect(201);

      expect(await overtimeFor(staffToken)).toBe(bankBefore - 5 * 480);
      expect((await balanceFor(staffToken, yearOf(from))).takenDays).toBe(quotaBefore);
    });

    it('credits the day, so the timesheet does not charge it twice', async () => {
      // The bank paid for the day already. Leaving it uncredited would book a
      // full day of shortfall on top, against the same balance.
      // Ten weeks ahead of the current one — `me/week` pages by offset, not by date.
      const week = await http()
        .get('/api/attendance/me/week?offset=10')
        .set(as(staffToken))
        .expect(200);
      const monday = week.body.days.find((day: { date: string }) => day.date === from);

      expect(monday).toMatchObject({
        absenceTag: 'Overtime compensation',
        credited: true,
        balanceMinutes: 0,
        targetMinutes: 480,
      });
    });
  });

  describe('withdrawing', () => {
    it('takes back a pending request', async () => {
      const day = shift(THIS_MONDAY, 49);
      const created = await http()
        .post('/api/absences')
        .set(as(staffToken))
        .send({ typeId: vacationTypeId, startsOn: day, endsOn: day })
        .expect(201);

      await http().delete(`/api/absences/${created.body.id}`).set(as(staffToken)).expect(204);

      const mine = await http().get('/api/absences').set(as(staffToken)).expect(200);
      expect(mine.body.some((absence: { id: string }) => absence.id === created.body.id)).toBe(false);
    });

    it('refuses to take back days already granted', async () => {
      const mine = await http().get('/api/absences').set(as(staffToken)).expect(200);
      const approved = mine.body.find(
        (absence: { status: string }) => absence.status === 'approved' || absence.status === 'taken',
      );

      await http().delete(`/api/absences/${approved.id}`).set(as(staffToken)).expect(400);
    });

    it('will not take back someone else’s', async () => {
      const day = shift(THIS_MONDAY, 56);
      const created = await http()
        .post('/api/absences')
        .set(as(otherToken))
        .send({ typeId: vacationTypeId, startsOn: day, endsOn: day })
        .expect(201);

      await http().delete(`/api/absences/${created.body.id}`).set(as(staffToken)).expect(403);
    });
  });

  describe('the timesheet', () => {
    it('tags a credited day and leaves its balance at zero', async () => {
      const created = await http()
        .post('/api/absences')
        .set(as(otherToken))
        .send({ typeId: vacationTypeId, startsOn: THIS_MONDAY, endsOn: THIS_MONDAY })
        .expect(201);

      await http()
        .post(`/api/absences/${created.body.id}/approve`)
        .set(as(ownerToken))
        .send({})
        .expect(201);

      const week = await http().get('/api/attendance/me/week').set(as(otherToken)).expect(200);
      const monday = week.body.days.find((day: { date: string }) => day.date === THIS_MONDAY);

      expect(monday).toMatchObject({ absenceTag: 'Vacation', credited: true, balanceMinutes: 0 });
      // The day still counts toward the week's target — it is credited, not skipped.
      expect(monday.targetMinutes).toBe(480);
    });

    it('tags a home-office day without crediting it', async () => {
      const day = shift(THIS_MONDAY, 1);
      const created = await http()
        .post('/api/absences')
        .set(as(otherToken))
        .send({ typeId: homeOfficeTypeId, startsOn: day, endsOn: day })
        .expect(201);

      // Home office costs no quota at all — the type does not deduct.
      expect(created.body.costDays).toBe(0);

      await http()
        .post(`/api/absences/${created.body.id}/approve`)
        .set(as(ownerToken))
        .send({})
        .expect(201);

      const week = await http().get('/api/attendance/me/week').set(as(otherToken)).expect(200);
      const tuesday = week.body.days.find((entry: { date: string }) => entry.date === day);

      // Real hours are still expected, so an empty home-office day runs a deficit.
      expect(tuesday).toMatchObject({ absenceTag: 'Home office', credited: false });
      expect(tuesday.balanceMinutes).toBe(-480);
    });
  });

  describe('the calendar', () => {
    it('returns every day of the range, weekends and holidays flagged', async () => {
      const from = shift(THIS_MONDAY, 28);
      const to = shift(from, 6);

      const response = await http()
        .get(`/api/absences/calendar?from=${from}&to=${to}`)
        .set(as(staffToken))
        .expect(200);

      expect(response.body.days).toHaveLength(7);
      expect(response.body.days.at(-1).weekend).toBe(true);
      expect(response.body.days[2].holiday).toBe('Founders Day');
      // The pending request raised over that week is on the grid, tint and all.
      expect(response.body.days[0].absences[0]).toMatchObject({ typeKey: 'vacation' });
    });

    it('shows an employee only their own days', async () => {
      const response = await http()
        .get(`/api/absences/calendar?from=${THIS_MONDAY}&to=${shift(THIS_MONDAY, 6)}`)
        .set(as(staffToken))
        .expect(200);

      const names = response.body.days.flatMap((day: { absences: { userId: string }[] }) =>
        day.absences.map((absence) => absence.userId),
      );

      expect(names.every((id: string) => id === staffId)).toBe(true);
    });

    it("keeps the requester's own reason on their own calendar", async () => {
      // The week the "Sailing" request covers — approved above, with "Enjoy" as its
      // decision note. THIS_MONDAY itself holds nothing of staff's, so anchoring here
      // is what makes this assert something.
      const response = await http()
        .get(`/api/absences/calendar?from=${shift(THIS_MONDAY, 14)}&to=${shift(THIS_MONDAY, 18)}`)
        .set(as(staffToken))
        .expect(200);

      const mine = absencesOf(response.body, staffId);

      expect(mine.length).toBeGreaterThan(0);
      expect(mine.some((absence) => absence.note === 'Sailing')).toBe(true);
      expect(mine.some((absence) => absence.decisionNote === 'Enjoy')).toBe(true);
    });

    it('will not widen to the whole organization without holiday:approve', async () => {
      await http()
        .get(`/api/absences/calendar?scope=organization`)
        .set(as(staffToken))
        .expect(403);
    });
  });

  describe('a malformed id', () => {
    /**
     * Path params have always gone through ParseUUIDPipe; query params went straight to
     * MikroORM, where a bad uuid reaches Postgres and comes back as a 500. A bad id is
     * a client bug and deserves a 400 — see `OptionalUuidPipe`.
     */
    it('is a 400, not a 500 from Postgres', async () => {
      await http().get('/api/absences?userId=not-a-uuid').set(as(staffToken)).expect(400);
      await http()
        .get(`/api/absences/calendar?userId=%27%20or%201%3D1--`)
        .set(as(staffToken))
        .expect(400);
    });

    it('still reads an empty value as no filter at all, the way it always did', async () => {
      await http().get('/api/absences?userId=').set(as(staffToken)).expect(200);
    });
  });

  describe('reading someone else', () => {
    it('is refused to a peer', async () => {
      await http().get(`/api/absences?userId=${otherId}`).set(as(staffToken)).expect(403);
    });

    it('is allowed to an approver', async () => {
      const response = await http()
        .get(`/api/absences?userId=${staffId}`)
        .set(as(ownerToken))
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body.every((absence: { userId: string }) => absence.userId === staffId)).toBe(
        true,
      );
    });
  });

  /**
   * The screens absence shares with attendance are opened by people who approve time
   * off but never ask for it themselves. The default `manager` role holds
   * `holiday:approve` and no `holiday:request` at all, so every read on this path has
   * to be reachable without the requester's permission.
   */
  describe('an approver who never requests', () => {
    beforeAll(async () => {
      const token = await invite(BOSS_EMAIL, 'Bea');
      const people = await http().get('/api/users').set(as(ownerToken)).expect(200);
      const bossId = people.body.find((person: { email: string }) => person.email === BOSS_EMAIL).id;

      const roles = await http()
        .get('/api/organizations/current/roles')
        .set(as(ownerToken))
        .expect(200);
      const manager = roles.body.find((role: { key: string }) => role.key === 'manager');

      await http()
        .post(`/api/users/${bossId}/roles`)
        .set(as(ownerToken))
        .send({ roleIds: [manager.id] })
        .expect(201);

      // Staff report to them, so the queue and the team calendar have something in.
      await http()
        .patch(`/api/users/${staffId}`)
        .set(as(ownerToken))
        .send({ managerId: bossId })
        .expect(200);

      // The access token carries the permission set, so a role change only lands on
      // the next one — sign in again rather than reusing the invitation's token.
      const signedIn = await http()
        .post('/api/auth/login')
        .send({ email: BOSS_EMAIL, password: PASSWORD })
        .expect(200);

      managerToken = signedIn.body.accessToken;
      expect(signedIn.body.user.permissions).toContain('holiday:approve');
      expect(signedIn.body.user.permissions).not.toContain('holiday:request');
      void token;
    });

    it('reads the calendar', async () => {
      await http()
        .get(`/api/absences/calendar?from=${THIS_MONDAY}&to=${shift(THIS_MONDAY, 6)}&scope=team`)
        .set(as(managerToken))
        .expect(200);
    });

    /**
     * A calendar answers who is away and when. The free text behind an absence — and
     * the title of any sick note attached to it — is special-category data under GDPR
     * Art. 9, and rendering a month grid never needed it. The approvals queue below is
     * the surface that does, and keeps it.
     */
    it("reads no one else's reason off the calendar, at any scope", async () => {
      // Staff report to this manager, and the "Sailing" request that week carries both
      // a note and a decision note — so there is something real to be redacted.
      for (const scope of ['team', 'organization']) {
        const response = await http()
          .get(
            `/api/absences/calendar?from=${shift(THIS_MONDAY, 14)}&to=${shift(THIS_MONDAY, 18)}&scope=${scope}`,
          )
          .set(as(managerToken))
          .expect(200);

        const theirs = absencesOf(response.body, staffId);

        expect(theirs.length).toBeGreaterThan(0);
        for (const absence of theirs) {
          // The type still colours the cell; only the reason is gone.
          expect(absence.typeKey).toEqual(expect.any(String));
          expect(absence.note).toBeNull();
          expect(absence.decisionNote).toBeNull();
          expect(absence.documentId).toBeNull();
          expect(absence.documentTitle).toBeNull();
        }
      }
    });

    it('still reads the reason in the queue it decides', async () => {
      const response = await http().get('/api/absences').set(as(managerToken)).expect(200);

      const withReason = response.body.filter(
        (absence: { userId: string; note: string | null }) =>
          absence.userId === staffId && absence.note !== null,
      );

      expect(withReason.length).toBeGreaterThan(0);
    });

    it('reads the absence types, because every screen tags a day with one', async () => {
      const response = await http().get('/api/absences/types').set(as(managerToken)).expect(200);

      expect(response.body).toHaveLength(9);
    });

    it('reads the queue it is expected to decide', async () => {
      const response = await http().get('/api/absences').set(as(managerToken)).expect(200);

      expect(response.body.some((absence: { userId: string }) => absence.userId === staffId)).toBe(
        true,
      );
    });

    it('reads its own balance, empty though it is', async () => {
      const response = await http()
        .get('/api/absences/balances/me')
        .set(as(managerToken))
        .expect(200);

      expect(response.body.takenDays).toBe(0);
    });

    it('still may not raise a request without holiday:request', async () => {
      await http()
        .post('/api/absences')
        .set(as(managerToken))
        .send({
          typeId: vacationTypeId,
          startsOn: shift(THIS_MONDAY, 112),
          endsOn: shift(THIS_MONDAY, 112),
        })
        .expect(403);
    });
  });

  describe('the quota', () => {
    it('is set by someone holding employee:manage', async () => {
      const year = yearOf(THIS_MONDAY);

      const response = await http()
        .post(`/api/users/${otherId}/leave-balance`)
        .set(as(ownerToken))
        .send({ year, entitlementDays: 25, carryOverDays: 4, carryOverExpiresOn: `${year}-03-31` })
        .expect(201);

      expect(response.body).toMatchObject({ entitlementDays: 25, carryOverDays: 4 });
    });

    it('is not something an employee may set for themselves', async () => {
      await http()
        .post(`/api/users/${otherId}/leave-balance`)
        .set(as(otherToken))
        .send({ year: yearOf(THIS_MONDAY), entitlementDays: 99 })
        .expect(403);
    });
  });

  /**
   * The races the read-then-write flows above must not lose. Two requests fired in
   * the same instant are the honest simulation of a double-click, and each pair has
   * exactly one winner by construction — the advisory locks the service takes make
   * the second one observe the first.
   */
  describe('concurrent writes', () => {
    it('lets one of two requests over the same days through', async () => {
      const day = shift(THIS_MONDAY, 98);

      const [left, right] = await Promise.all([
        http()
          .post('/api/absences')
          .set(as(otherToken))
          .send({ typeId: vacationTypeId, startsOn: day, endsOn: shift(day, 2) }),
        http()
          .post('/api/absences')
          .set(as(otherToken))
          .send({ typeId: vacationTypeId, startsOn: day, endsOn: shift(day, 2) }),
      ]);

      // The overlap check and the insert are atomic: one wins, the other is refused.
      expect([left.status, right.status].sort()).toEqual([201, 400]);
    });

    it('commits the days once when two approvals arrive together', async () => {
      const day = shift(THIS_MONDAY, 105);
      const created = await http()
        .post('/api/absences')
        .set(as(otherToken))
        .send({ typeId: vacationTypeId, startsOn: day, endsOn: day })
        .expect(201);

      const before = await balanceFor(otherToken, yearOf(day));

      const [left, right] = await Promise.all([
        http().post(`/api/absences/${created.body.id}/approve`).set(as(ownerToken)).send({}),
        http().post(`/api/absences/${created.body.id}/approve`).set(as(ownerToken)).send({}),
      ]);

      // Exactly one approval lands; the other loses on the pending check — and the
      // quota moved by exactly the one day, not twice.
      expect([left.status, right.status].sort()).toEqual([201, 400]);

      const after = await balanceFor(otherToken, yearOf(day));
      expect(after.takenDays).toBe(before.takenDays + 1);
    });
  });
});
