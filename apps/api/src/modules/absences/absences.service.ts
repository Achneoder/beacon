import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ABSENCE_TYPES,
  absenceCostByYear,
  absenceCostDays,
  datesBetween,
  fullName,
  isWeekend,
  rangesOverlap,
  remainingLeaveDays,
  type AbsenceCalendar,
  type AbsenceRequestSummary,
  type AbsenceStatus,
  type AbsenceTypeSummary,
  type CalendarDay,
  type CreateAbsenceRequest,
  type HolidaySummary,
  type LeaveBalanceSummary,
} from '@beacon/shared';
import { localDate, resolveTimezone } from '../../common/time/zone.js';
import { lockAdvisory } from '../../common/db/advisory-lock.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { Document } from '../documents/document.entity.js';
import { AbsenceRequest } from './absence-request.entity.js';
import { AbsenceType } from './absence-type.entity.js';
import { Holiday } from './holiday.entity.js';
import { LeaveBalance } from './leave-balance.entity.js';
import type { CreateAbsenceTypeDto } from './dto/create-absence-type.dto.js';
import type { CreateHolidayDto } from './dto/create-holiday.dto.js';
import type { UpsertLeaveBalanceDto } from './dto/upsert-leave-balance.dto.js';

/** The quota a person gets until someone sets one for them. */
const DEFAULT_ENTITLEMENT_DAYS = 30;

/**
 * Namespaces for the advisory locks — see {@link lockAdvisory}. The decide lock is
 * shared by {@link decide} and {@link withdraw}, so a withdrawal cannot delete a
 * request an approval is mid-way through paying for.
 */
const ABSENCE_CREATE_LOCK = 20_260_004;
const ABSENCE_DECIDE_LOCK = 20_260_005;

/** Who is asking, and how far the guard already let them see. */
export interface Caller {
  id: string;
  organizationId: string;
  /** True when the caller holds `holiday:approve` — they may read and decide widely. */
  canApprove: boolean;
  /** True when the caller holds `document:manage` — carried through to
   *  `DocumentsService.findVisible` so an admin attaching a sick note sees as widely
   *  as they do everywhere else in the documents module. */
  canManageDocuments: boolean;
}

/**
 * What each day of a range is covered by: the absence type's name for the tag, and
 * whether the day's target was met by the absence rather than by worked time.
 */
export type DayCoverage = Map<string, { tag: string; credited: boolean }>;

export interface CalendarFilter {
  from?: string;
  to?: string;
  /** A single person; omitted, an approver sees their reports and everyone else themselves. */
  userId?: string;
  /** `true` widens an approver's calendar to the whole organization. */
  scope?: 'me' | 'team' | 'organization';
}

@Injectable()
export class AbsencesService {
  constructor(
    private readonly em: EntityManager,
    private readonly users: UsersService,
    private readonly documents: DocumentsService,
  ) {}

  // ---------------------------------------------------------------- types

  /**
   * The organization's absence types, seeded on first read.
   *
   * Seeding lazily rather than in `createWithOwner` keeps organizations that predate
   * this phase working: the first calendar load fills them in, and the unique key on
   * `(organization, key)` makes a concurrent double-seed a conflict rather than a
   * duplicate list.
   */
  async listTypes(organizationId: string, includeInactive = false): Promise<AbsenceTypeSummary[]> {
    let types = await this.em.find(
      AbsenceType,
      { organization: organizationId },
      { orderBy: { position: 'asc', name: 'asc' } },
    );

    if (types.length === 0) types = await this.seedTypes(organizationId);

    return types
      .filter((type) => includeInactive || type.active)
      .map(toAbsenceTypeSummary);
  }

  async createType(organizationId: string, dto: CreateAbsenceTypeDto): Promise<AbsenceTypeSummary> {
    const existing = await this.em.count(AbsenceType, { organization: organizationId, key: dto.key });
    if (existing > 0) throw new BadRequestException('that key is already in use');

    const type = this.em.create(AbsenceType, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      key: dto.key,
      name: dto.name,
      deductsFromQuota: dto.deductsFromQuota ?? false,
      paid: dto.paid ?? true,
      countsAsWork: dto.countsAsWork ?? false,
      colorRole: dto.colorRole ?? 'accent',
      active: true,
      position: dto.position ?? 0,
    });

    await this.em.flush();

    return toAbsenceTypeSummary(type);
  }

  /** Retiring a type rather than deleting it — old requests must keep naming theirs. */
  async retireType(organizationId: string, typeId: string): Promise<AbsenceTypeSummary> {
    const type = await this.em.findOne(AbsenceType, { id: typeId, organization: organizationId });
    if (!type) throw new NotFoundException('absence type not found');

    type.active = false;
    await this.em.flush();

    return toAbsenceTypeSummary(type);
  }

  private async seedTypes(organizationId: string): Promise<AbsenceType[]> {
    const organization = this.em.getReference(Organization, organizationId, { wrapped: true });
    const created = DEFAULT_ABSENCE_TYPES.map((seed, position) =>
      this.em.create(AbsenceType, { organization, ...seed, active: true, position }),
    );

    await this.em.flush();

    return created;
  }

  // ---------------------------------------------------------------- holidays

  async listHolidays(
    organizationId: string,
    from?: string,
    to?: string,
    /** Explicit when called inside `em.transactional` — the fork owns the reads. */
    em: EntityManager = this.em,
  ): Promise<HolidaySummary[]> {
    const where: Record<string, unknown> = { organization: organizationId };
    if (from && to) where.date = { $gte: from, $lte: to };

    const holidays = await em.find(Holiday, where, { orderBy: { date: 'asc' } });

    return holidays.map(toHolidaySummary);
  }

  async createHoliday(organizationId: string, dto: CreateHolidayDto): Promise<HolidaySummary> {
    const holiday = this.em.create(Holiday, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      date: dto.date,
      name: dto.name,
      region: dto.region ?? null,
    });

    await this.em.flush();

    return toHolidaySummary(holiday);
  }

  async deleteHoliday(organizationId: string, holidayId: string): Promise<void> {
    const holiday = await this.em.findOne(Holiday, { id: holidayId, organization: organizationId });
    if (!holiday) throw new NotFoundException('holiday not found');

    await this.em.removeAndFlush(holiday);
  }

  // ---------------------------------------------------------------- requests

  /**
   * Raising a request. The cost is computed here, against the public holidays in
   * force today, and then frozen on the row — a holiday added in November must not
   * silently rewrite an August absence that has already been taken and paid.
   */
  async create(caller: Caller, dto: CreateAbsenceRequest): Promise<AbsenceRequestSummary> {
    const subjectId = await this.resolveSubject(caller, dto.userId ?? undefined, true);

    if (dto.endsOn < dto.startsOn) {
      throw new BadRequestException('the last day must not precede the first');
    }

    const type = await this.em.findOne(AbsenceType, {
      id: dto.typeId,
      organization: caller.organizationId,
      active: true,
    });
    if (!type) throw new NotFoundException('absence type not found');

    // An invisible document is a 404 — that 404 *is* the enforcement. A manager
    // cannot staple their own file to an employee's request: the document must
    // belong to whoever the absence is for, not to whoever is raising it.
    let documentId: string | null = null;
    if (dto.documentId) {
      const found = await this.documents.findVisible(
        { id: caller.id, organizationId: caller.organizationId, canManage: caller.canManageDocuments },
        dto.documentId,
      );
      if (found.owner?.id !== subjectId) {
        throw new BadRequestException('the document belongs to someone else');
      }
      documentId = found.id;
    }

    // The overlap check and the insert only hold together while nobody else can
    // insert for the same subject in between: two requests raised in the same
    // second over the same days would otherwise both pass `assertFree`. The
    // advisory lock serializes on the subject, so different people still request
    // concurrently.
    return this.em.transactional(async (em) => {
      await lockAdvisory(em, ABSENCE_CREATE_LOCK, `${caller.organizationId}:${subjectId}`);

      const user = await em.findOne(
        User,
        { id: subjectId, organization: caller.organizationId },
        { populate: ['manager'] },
      );
      if (!user) throw new NotFoundException('user not found');

      await this.assertFree(em, caller.organizationId, subjectId, dto.startsOn, dto.endsOn);

      const holidays = await this.holidayDates(em, caller.organizationId, dto.startsOn, dto.endsOn);
      const request = {
        startsOn: dto.startsOn,
        endsOn: dto.endsOn,
        halfDayStart: dto.halfDayStart ?? false,
        halfDayEnd: dto.halfDayEnd ?? false,
      };
      const workingDays = absenceCostDays({ ...request, halfDayStart: false, halfDayEnd: false }, holidays);
      if (workingDays === 0) {
        throw new BadRequestException('that range contains no working days');
      }

      const absence = em.create(AbsenceRequest, {
        organization: em.getReference(Organization, caller.organizationId, { wrapped: true }),
        user: ref(user),
        type: em.getReference(AbsenceType, type.id),
        ...request,
        status: 'pending',
        costDays: type.deductsFromQuota ? absenceCostDays(request, holidays) : 0,
        approver: user.manager,
        note: dto.note ?? null,
        document: documentId ? em.getReference(Document, documentId) : null,
      });

      await em.flush();
      await em.populate(absence, ['user', 'type', 'approver', 'document']);

      return toAbsenceSummary(absence, holidays);
    });
  }

  /**
   * Own requests, a manager's queue, or one person's history.
   *
   * `taken` is settled here rather than by a scheduled job: the state only matters
   * when someone looks, and a nightly task that has not run yet would show an absence
   * as still upcoming a week after it ended.
   */
  async list(
    caller: Caller,
    filter: { userId?: string; status?: AbsenceStatus; mine?: boolean } = {},
  ): Promise<AbsenceRequestSummary[]> {
    const where: Record<string, unknown> = { organization: caller.organizationId };

    if (filter.userId) {
      where.user = await this.resolveSubject(caller, filter.userId);
    } else if (filter.mine || !caller.canApprove) {
      where.user = caller.id;
    }
    if (filter.status) where.status = filter.status;

    const requests = await this.em.find(AbsenceRequest, where, {
      populate: ['user', 'type', 'approver', 'document'],
      orderBy: { startsOn: 'desc' },
    });

    await this.settleTaken(this.em, caller.organizationId, requests);

    return this.summarize(this.em, caller.organizationId, requests);
  }

  /**
   * Withdrawing your own request. Only while it is still a question.
   *
   * Shares the decide lock — a withdrawal racing an approval must lose to it, not
   * delete a request whose days were just committed to the balance.
   */
  async withdraw(caller: Caller, requestId: string): Promise<void> {
    await this.em.transactional(async (em) => {
      await lockAdvisory(em, ABSENCE_DECIDE_LOCK, requestId);

      const request = await em.findOne(AbsenceRequest, {
        id: requestId,
        organization: caller.organizationId,
      });
      if (!request) throw new NotFoundException('request not found');
      if (request.user.id !== caller.id) {
        throw new ForbiddenException('you may only withdraw your own requests');
      }
      if (request.status !== 'pending') {
        throw new BadRequestException('only a pending request can be withdrawn');
      }

      await em.removeAndFlush(request);
    });
  }

  /**
   * Deciding. Approving commits the days to the balance of each year the request
   * touches — a holiday over New Year spends two quotas, not one.
   *
   * The advisory lock makes this atomic against a concurrent decide or withdraw:
   * two approvals would otherwise both pass the pending check and commit the days
   * twice.
   */
  async decide(
    caller: Caller,
    requestId: string,
    approved: boolean,
    note?: string | null,
  ): Promise<AbsenceRequestSummary> {
    return this.em.transactional(async (em) => {
      await lockAdvisory(em, ABSENCE_DECIDE_LOCK, requestId);

      const request = await em.findOne(
        AbsenceRequest,
        { id: requestId, organization: caller.organizationId },
        { populate: ['user', 'type', 'approver', 'document'] },
      );
      if (!request) throw new NotFoundException('request not found');
      if (request.status !== 'pending') {
        throw new BadRequestException('that request has already been decided');
      }
      if (request.user.id === caller.id) {
        throw new ForbiddenException('you cannot decide your own request');
      }

      request.status = approved ? 'approved' : 'rejected';
      request.decidedAt = new Date();
      request.decidedBy = em.getReference(User, caller.id, { wrapped: true });
      request.decisionNote = note ?? null;

      if (approved && request.type.getEntity().deductsFromQuota) {
        await this.commitToBalances(em, caller.organizationId, request, 1);
      }

      await em.flush();
      await this.settleTaken(em, caller.organizationId, [request]);

      return (await this.summarize(em, caller.organizationId, [request]))[0];
    });
  }

  // ---------------------------------------------------------------- calendar

  /**
   * The month grid. Every day in the range is returned, weekend and holiday flags
   * included, so the client renders six rows without repeating the arithmetic.
   */
  async calendar(caller: Caller, filter: CalendarFilter = {}): Promise<AbsenceCalendar> {
    const timezone = await this.timezoneOf(caller);
    const today = localDate(timezone);
    const from = filter.from ?? `${today.slice(0, 7)}-01`;
    const to = filter.to ?? endOfMonth(from);

    const userIds = await this.calendarSubjects(caller, filter);
    const requests = await this.em.find(
      AbsenceRequest,
      {
        organization: caller.organizationId,
        user: { $in: userIds },
        status: { $ne: 'rejected' },
        startsOn: { $lte: to },
        endsOn: { $gte: from },
      },
      { populate: ['user', 'type', 'approver', 'document'], orderBy: { startsOn: 'asc' } },
    );
    await this.settleTaken(this.em, caller.organizationId, requests);

    const holidays = await this.listHolidays(caller.organizationId, from, to, this.em);
    const byDate = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
    const summaries = await this.summarize(this.em, caller.organizationId, requests);

    const days: CalendarDay[] = datesBetween(from, to).map((date) => ({
      date,
      weekend: isWeekend(date),
      holiday: byDate.get(date) ?? null,
      absences: summaries.filter(
        (absence) => absence.startsOn <= date && date <= absence.endsOn,
      ),
    }));

    return { from, to, timezone, days, holidays };
  }

  // ---------------------------------------------------------------- balances

  async balanceOf(caller: Caller, userId?: string, year?: number): Promise<LeaveBalanceSummary> {
    const subjectId = await this.resolveSubject(caller, userId);
    const timezone = await this.timezoneOf(caller, subjectId);
    const today = localDate(timezone);
    const forYear = year ?? Number(today.slice(0, 4));

    const balance = await this.ensureBalance(this.em, caller.organizationId, subjectId, forYear);
    const pendingDays = await this.pendingDaysOf(caller.organizationId, subjectId, forYear);

    return toBalanceSummary(balance, pendingDays, today);
  }

  /** Setting a quota — `employee:manage`, because it is an employment term. */
  async upsertBalance(
    caller: Caller,
    userId: string,
    dto: UpsertLeaveBalanceDto,
  ): Promise<LeaveBalanceSummary> {
    const user = await this.users.findEntity(caller.organizationId, userId);
    const balance = await this.ensureBalance(this.em, caller.organizationId, user.id, dto.year);

    if (dto.entitlementDays !== undefined) balance.entitlementDays = dto.entitlementDays;
    if (dto.carryOverDays !== undefined) balance.carryOverDays = dto.carryOverDays;
    if (dto.carryOverExpiresOn !== undefined) balance.carryOverExpiresOn = dto.carryOverExpiresOn;

    await this.em.flush();

    const timezone = await this.timezoneOf(caller, user.id);
    const pendingDays = await this.pendingDaysOf(caller.organizationId, user.id, dto.year);

    return toBalanceSummary(balance, pendingDays, localDate(timezone));
  }

  /**
   * A year's quota for a set of people, in three queries rather than three per head.
   *
   * Unlike {@link balanceOf} this **writes nothing**: `ensureBalance` materialises a
   * row on first read, which is right for a screen someone is standing in front of and
   * wrong for a report — running the absence report would otherwise create a quota row
   * for every employee who has never asked for a day off, and a read that writes is a
   * read that can block behind an approval. A person with no row reports the default
   * entitlement, computed in memory.
   *
   * The map holds an entry for every id asked about, so the caller never distinguishes
   * "no quota" from "not asked".
   */
  async balancesFor(
    organizationId: string,
    userIds: readonly string[],
    year: number,
    on: string,
  ): Promise<Map<string, LeaveBalanceSummary>> {
    const summaries = new Map<string, LeaveBalanceSummary>();
    if (userIds.length === 0) return summaries;

    const ids = [...userIds];
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const [rows, pending, holidays] = await Promise.all([
      this.em.find(LeaveBalance, { organization: organizationId, user: { $in: ids }, year }),
      this.em.find(AbsenceRequest, {
        organization: organizationId,
        user: { $in: ids },
        status: 'pending',
        startsOn: { $lte: to },
        endsOn: { $gte: from },
      }),
      this.holidayDates(this.em, organizationId, from, to),
    ]);

    const byUser = new Map(rows.map((row) => [row.user.id, row]));
    const pendingDays = new Map<string, number>();
    for (const request of pending) {
      const days = absenceCostByYear(request, holidays).get(year) ?? 0;
      pendingDays.set(request.user.id, (pendingDays.get(request.user.id) ?? 0) + days);
    }

    for (const id of ids) {
      const row = byUser.get(id);
      const days = round(pendingDays.get(id) ?? 0);

      summaries.set(id, row ? toBalanceSummary(row, days, on) : defaultBalance(year, days, on));
    }

    return summaries;
  }

  /**
   * The absence covering each date in a range, for the timesheet.
   *
   * Attendance asks this rather than reaching into the tables itself: the tag on a
   * timesheet row and the tint on a calendar cell must be the same decision, and
   * `credited` — target met by the absence rather than by worked time — is exactly
   * the inverse of `countsAsWork`.
   */
  async coverageOf(
    organizationId: string,
    userId: string,
    from: string,
    to: string,
    em: EntityManager = this.em,
  ): Promise<DayCoverage> {
    const byUser = await this.coverageOfMany(organizationId, [userId], from, to, em);

    return byUser.get(userId) ?? new Map();
  }

  /**
   * The same answer for a set of people, in one query.
   *
   * Reporting reads a quarter across an organization; asking {@link coverageOf} per
   * person would be a round trip each, and doing the grouping here rather than in the
   * report is what keeps `credited` a single decision. The per-user map is always
   * present for every id asked about, so a caller never has to distinguish "no
   * absences" from "not asked".
   */
  async coverageOfMany(
    organizationId: string,
    userIds: readonly string[],
    from: string,
    to: string,
    em: EntityManager = this.em,
  ): Promise<Map<string, DayCoverage>> {
    const byUser = new Map<string, DayCoverage>(userIds.map((id) => [id, new Map()]));
    if (userIds.length === 0) return byUser;

    const requests = await em.find(
      AbsenceRequest,
      {
        organization: organizationId,
        user: { $in: [...userIds] },
        status: { $in: ['approved', 'taken'] },
        startsOn: { $lte: to },
        endsOn: { $gte: from },
      },
      { populate: ['type'] },
    );

    for (const request of requests) {
      const coverage = byUser.get(request.user.id);
      if (!coverage) continue;

      const type = request.type.getEntity();
      for (const date of datesBetween(request.startsOn, request.endsOn)) {
        if (date < from || date > to || isWeekend(date)) continue;
        coverage.set(date, { tag: type.name, credited: !type.countsAsWork });
      }
    }

    return byUser;
  }

  // ---------------------------------------------------------------- internals

  /**
   * Summaries with `workingDays` measured against the real holiday calendar.
   *
   * The holidays are fetched once for the whole span rather than per request: a
   * year's history is a single query either way, and the alternative is one round
   * trip per row.
   */
  private async summarize(
    em: EntityManager,
    organizationId: string,
    requests: AbsenceRequest[],
  ): Promise<AbsenceRequestSummary[]> {
    if (requests.length === 0) return [];

    const from = requests.reduce((first, r) => (r.startsOn < first ? r.startsOn : first), requests[0].startsOn);
    const to = requests.reduce((last, r) => (r.endsOn > last ? r.endsOn : last), requests[0].endsOn);
    const holidays = await this.holidayDates(em, organizationId, from, to);

    return requests.map((request) => toAbsenceSummary(request, holidays));
  }

  /**
   * Approved days move the balance of every year they touch. `direction` is `1` on
   * approval; a future rescission passes `-1` through the same path so the two can
   * never drift apart.
   */
  private async commitToBalances(
    em: EntityManager,
    organizationId: string,
    request: AbsenceRequest,
    direction: 1 | -1,
  ): Promise<void> {
    const holidays = await this.holidayDates(em, organizationId, request.startsOn, request.endsOn);
    const byYear = absenceCostByYear(request, holidays);

    for (const [year, days] of byYear) {
      const balance = await this.ensureBalance(em, organizationId, request.user.id, year);
      balance.takenDays = round(balance.takenDays + direction * days);
    }
  }

  private async ensureBalance(
    em: EntityManager,
    organizationId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalance> {
    const where = { organization: organizationId, user: userId, year };
    const existing = await em.findOne(LeaveBalance, where);
    if (existing) return existing;

    // Two concurrent first reads — the pricing screen and an approval, say — would
    // both pass the findOne above and collide on the (user, year) unique constraint.
    // The upsert turns the loser's insert into a no-op, and the refresh re-reads the
    // row the winner committed instead of returning the discarded stub.
    await em.upsert(
      LeaveBalance,
      {
        // upsert hydrates without running the constructor, so the field
        // initializers never run — every constructor-assigned column (the id and
        // both timestamps) has to be provided, or the not-null constraints bite.
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: organizationId,
        user: userId,
        year,
        entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
        carryOverDays: 0,
        carryOverExpiresOn: null,
        takenDays: 0,
      },
      // Without this the driver would conflict on the primary key we just
      // generated; the guard that matters is the (user, year) unique constraint.
      { onConflictAction: 'ignore', onConflictFields: ['user', 'year'] },
    );
    return em.findOneOrFail(LeaveBalance, where, { refresh: true });
  }

  private async pendingDaysOf(
    organizationId: string,
    userId: string,
    year: number,
  ): Promise<number> {
    const requests = await this.em.find(AbsenceRequest, {
      organization: organizationId,
      user: userId,
      status: 'pending',
      startsOn: { $lte: `${year}-12-31` },
      endsOn: { $gte: `${year}-01-01` },
    });

    const holidays = await this.holidayDates(this.em, organizationId, `${year}-01-01`, `${year}-12-31`);

    return round(
      requests.reduce(
        (total, request) => total + (absenceCostByYear(request, holidays).get(year) ?? 0),
        0,
      ),
    );
  }

  /** Approved becomes taken once the last day has passed, in the subject's own zone. */
  private async settleTaken(em: EntityManager, organizationId: string, requests: AbsenceRequest[]): Promise<void> {
    const stale = requests.filter((request) => request.status === 'approved');
    if (stale.length === 0) return;

    const timezone = await this.organizationTimezone(em, organizationId);
    const today = localDate(timezone);
    let changed = false;

    for (const request of stale) {
      if (request.endsOn < today) {
        request.status = 'taken';
        changed = true;
      }
    }

    if (changed) await em.flush();
  }

  /** Refuses a second absence over days already spoken for. */
  private async assertFree(
    em: EntityManager,
    organizationId: string,
    userId: string,
    startsOn: string,
    endsOn: string,
  ): Promise<void> {
    const clashing = await em.find(AbsenceRequest, {
      organization: organizationId,
      user: userId,
      status: { $ne: 'rejected' },
      startsOn: { $lte: endsOn },
      endsOn: { $gte: startsOn },
    });

    if (clashing.some((request) => rangesOverlap(request, { startsOn, endsOn }))) {
      throw new BadRequestException('those days already carry an absence');
    }
  }

  private async holidayDates(
    em: EntityManager,
    organizationId: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const holidays = await this.listHolidays(organizationId, from, to, em);

    return holidays.map((holiday) => holiday.date);
  }

  /** Own record always; a report's or anyone's, depending on the caller's reach. */
  private async resolveSubject(
    caller: Caller,
    userId?: string,
    writing = false,
  ): Promise<string> {
    if (!userId || userId === caller.id) return caller.id;
    if (caller.canApprove) return userId;

    if (writing) throw new ForbiddenException('you may only request your own absence');

    const reports = await this.users.subordinateIdsOf(caller.organizationId, caller.id);
    if (!reports.includes(userId)) {
      throw new ForbiddenException('you may only read your own absence');
    }

    return userId;
  }

  /**
   * Whose absences a calendar shows. The default is deliberately narrow — your own,
   * widening to your reports and then the organization only as the caller's reach
   * allows — because a calendar is the easiest place to leak who is off sick.
   */
  private async calendarSubjects(caller: Caller, filter: CalendarFilter): Promise<string[]> {
    if (filter.userId) return [await this.resolveSubject(caller, filter.userId)];
    if (filter.scope === 'me') return [caller.id];

    if (filter.scope === 'organization') {
      if (!caller.canApprove) throw new ForbiddenException('you may not read the whole calendar');
      const everyone = await this.users.list(caller.organizationId);

      return everyone.map((user) => user.id);
    }

    const reports = await this.users.subordinateIdsOf(caller.organizationId, caller.id);

    return [caller.id, ...reports];
  }

  private async timezoneOf(caller: Caller, userId?: string): Promise<string> {
    const user = await this.em.findOne(
      User,
      { id: userId ?? caller.id, organization: caller.organizationId },
      { fields: ['timezone'] },
    );

    return resolveTimezone(user?.timezone ?? null, await this.organizationTimezone(this.em, caller.organizationId));
  }

  private async organizationTimezone(em: EntityManager, organizationId: string): Promise<string> {
    const organization = await em.findOne(Organization, { id: organizationId });

    return organization?.timezone ?? 'UTC';
  }
}

/** Half days are the only fraction, so two decimals of slack is plenty. */
function round(days: number): number {
  return Math.round(days * 100) / 100;
}

/** The last day of the month `date` falls in. */
function endOfMonth(date: string): string {
  const at = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + 1);
  at.setUTCDate(0);

  return at.toISOString().slice(0, 10);
}

export function toAbsenceTypeSummary(type: AbsenceType): AbsenceTypeSummary {
  return {
    id: type.id,
    key: type.key,
    name: type.name,
    deductsFromQuota: type.deductsFromQuota,
    paid: type.paid,
    countsAsWork: type.countsAsWork,
    colorRole: type.colorRole,
    active: type.active,
    position: type.position,
  };
}

export function toHolidaySummary(holiday: Holiday): HolidaySummary {
  return {
    id: holiday.id,
    date: holiday.date,
    name: holiday.name,
    region: holiday.region,
  };
}

/**
 * Requires `user`, `type` and `approver` to be populated.
 *
 * `costDays` is read from the row rather than recomputed — it was frozen when the
 * request was raised. `workingDays` is a display figure, so it may be recomputed
 * against whatever holidays the caller passes, or fall back to the stored cost.
 */
export function toAbsenceSummary(
  request: AbsenceRequest,
  holidays: readonly string[] = [],
): AbsenceRequestSummary {
  const user = request.user.getEntity();
  const type = request.type.getEntity();
  const approver = request.approver?.getEntity() ?? null;
  const document = request.document?.getEntity() ?? null;

  return {
    id: request.id,
    userId: user.id,
    userName: fullName(user),
    typeId: type.id,
    typeKey: type.key,
    typeName: type.name,
    colorRole: type.colorRole,
    countsAsWork: type.countsAsWork,
    startsOn: request.startsOn,
    endsOn: request.endsOn,
    halfDayStart: request.halfDayStart,
    halfDayEnd: request.halfDayEnd,
    status: request.status,
    costDays: Number(request.costDays),
    workingDays: absenceCostDays(
      { startsOn: request.startsOn, endsOn: request.endsOn },
      holidays,
    ),
    approverId: approver?.id ?? null,
    approverName: approver ? fullName(approver) : null,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decisionNote: request.decisionNote,
    note: request.note,
    documentId: document?.id ?? null,
    documentTitle: document?.title ?? null,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * The quota someone has before anyone sets them one, computed rather than stored.
 * {@link AbsencesService.balancesFor} reports this for a person with no row instead of
 * creating one — a report must not write.
 */
function defaultBalance(year: number, pendingDays: number, on: string): LeaveBalanceSummary {
  const figures = {
    entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
    carryOverDays: 0,
    carryOverExpiresOn: null,
    takenDays: 0,
  };

  return { year, ...figures, pendingDays, remainingDays: remainingLeaveDays(figures, on) };
}

export function toBalanceSummary(
  balance: LeaveBalance,
  pendingDays: number,
  on: string,
): LeaveBalanceSummary {
  const figures = {
    entitlementDays: Number(balance.entitlementDays),
    carryOverDays: Number(balance.carryOverDays),
    carryOverExpiresOn: balance.carryOverExpiresOn,
    takenDays: Number(balance.takenDays),
  };

  return {
    year: balance.year,
    ...figures,
    pendingDays,
    remainingDays: remainingLeaveDays(figures, on),
  };
}
