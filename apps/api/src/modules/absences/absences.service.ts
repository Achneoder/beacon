import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref, type Ref } from '@mikro-orm/core';
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
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { Document } from '../documents/document.entity.js';
import { AbsenceRequest } from './absence-request.entity.js';
import { AbsenceType } from './absence-type.entity.js';
import { Holiday } from './holiday.entity.js';
import { LeaveBalance } from './leave-balance.entity.js';
import type { CreateAbsenceTypeDto } from './dto/create-absence-type.dto.js';
import type { CreateHolidayDto } from './dto/create-holiday.dto.js';
import type { UpsertLeaveBalanceDto } from './dto/upsert-leave-balance.dto.js';

/** The quota a person gets until someone sets one for them. */
const DEFAULT_ENTITLEMENT_DAYS = 30;

/** Who is asking, and how far the guard already let them see. */
export interface Caller {
  id: string;
  organizationId: string;
  /** True when the caller holds `holiday:approve` — they may read and decide widely. */
  canApprove: boolean;
}

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

  async listHolidays(organizationId: string, from?: string, to?: string): Promise<HolidaySummary[]> {
    const where: Record<string, unknown> = { organization: organizationId };
    if (from && to) where.date = { $gte: from, $lte: to };

    const holidays = await this.em.find(Holiday, where, { orderBy: { date: 'asc' } });

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

    await this.assertFree(caller.organizationId, subjectId, dto.startsOn, dto.endsOn);

    const holidays = await this.holidayDates(caller.organizationId, dto.startsOn, dto.endsOn);
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

    // An invisible document is a 404 — that 404 *is* the enforcement. A manager
    // cannot staple their own file to an employee's request: the document must
    // belong to whoever the absence is for, not to whoever is raising it.
    let document: Ref<Document> | null = null;
    if (dto.documentId) {
      const found = await this.documents.findVisible(
        { id: caller.id, organizationId: caller.organizationId, canManage: false },
        dto.documentId,
      );
      if (found.owner?.id !== subjectId) {
        throw new BadRequestException('the document belongs to someone else');
      }
      document = ref(found);
    }

    const user = await this.users.findEntity(caller.organizationId, subjectId);
    const absence = this.em.create(AbsenceRequest, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      user: ref(user),
      type: ref(type),
      ...request,
      status: 'pending',
      costDays: type.deductsFromQuota ? absenceCostDays(request, holidays) : 0,
      approver: user.manager,
      note: dto.note ?? null,
      document,
    });

    await this.em.flush();
    await this.em.populate(absence, ['user', 'type', 'approver', 'document']);

    return toAbsenceSummary(absence, holidays);
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

    await this.settleTaken(caller.organizationId, requests);

    return this.summarize(caller.organizationId, requests);
  }

  /** Withdrawing your own request. Only while it is still a question. */
  async withdraw(caller: Caller, requestId: string): Promise<void> {
    const request = await this.em.findOne(AbsenceRequest, {
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

    await this.em.removeAndFlush(request);
  }

  /**
   * Deciding. Approving commits the days to the balance of each year the request
   * touches — a holiday over New Year spends two quotas, not one.
   */
  async decide(
    caller: Caller,
    requestId: string,
    approved: boolean,
    note?: string | null,
  ): Promise<AbsenceRequestSummary> {
    const request = await this.em.findOne(
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
    request.decidedBy = this.em.getReference(User, caller.id, { wrapped: true });
    request.decisionNote = note ?? null;

    if (approved && request.type.getEntity().deductsFromQuota) {
      await this.commitToBalances(caller.organizationId, request, 1);
    }

    await this.em.flush();
    await this.settleTaken(caller.organizationId, [request]);

    return (await this.summarize(caller.organizationId, [request]))[0];
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
    await this.settleTaken(caller.organizationId, requests);

    const holidays = await this.listHolidays(caller.organizationId, from, to);
    const byDate = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
    const summaries = await this.summarize(caller.organizationId, requests);

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

    const balance = await this.ensureBalance(caller.organizationId, subjectId, forYear);
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
    const balance = await this.ensureBalance(caller.organizationId, user.id, dto.year);

    if (dto.entitlementDays !== undefined) balance.entitlementDays = dto.entitlementDays;
    if (dto.carryOverDays !== undefined) balance.carryOverDays = dto.carryOverDays;
    if (dto.carryOverExpiresOn !== undefined) balance.carryOverExpiresOn = dto.carryOverExpiresOn;

    await this.em.flush();

    const timezone = await this.timezoneOf(caller, user.id);
    const pendingDays = await this.pendingDaysOf(caller.organizationId, user.id, dto.year);

    return toBalanceSummary(balance, pendingDays, localDate(timezone));
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
  ): Promise<Map<string, { tag: string; credited: boolean }>> {
    const requests = await this.em.find(
      AbsenceRequest,
      {
        organization: organizationId,
        user: userId,
        status: { $in: ['approved', 'taken'] },
        startsOn: { $lte: to },
        endsOn: { $gte: from },
      },
      { populate: ['type'] },
    );

    const coverage = new Map<string, { tag: string; credited: boolean }>();
    for (const request of requests) {
      const type = request.type.getEntity();
      for (const date of datesBetween(request.startsOn, request.endsOn)) {
        if (date < from || date > to || isWeekend(date)) continue;
        coverage.set(date, { tag: type.name, credited: !type.countsAsWork });
      }
    }

    return coverage;
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
    organizationId: string,
    requests: AbsenceRequest[],
  ): Promise<AbsenceRequestSummary[]> {
    if (requests.length === 0) return [];

    const from = requests.reduce((first, r) => (r.startsOn < first ? r.startsOn : first), requests[0].startsOn);
    const to = requests.reduce((last, r) => (r.endsOn > last ? r.endsOn : last), requests[0].endsOn);
    const holidays = await this.holidayDates(organizationId, from, to);

    return requests.map((request) => toAbsenceSummary(request, holidays));
  }

  /**
   * Approved days move the balance of every year they touch. `direction` is `1` on
   * approval; a future rescission passes `-1` through the same path so the two can
   * never drift apart.
   */
  private async commitToBalances(
    organizationId: string,
    request: AbsenceRequest,
    direction: 1 | -1,
  ): Promise<void> {
    const holidays = await this.holidayDates(organizationId, request.startsOn, request.endsOn);
    const byYear = absenceCostByYear(request, holidays);

    for (const [year, days] of byYear) {
      const balance = await this.ensureBalance(organizationId, request.user.id, year);
      balance.takenDays = round(balance.takenDays + direction * days);
    }
  }

  private async ensureBalance(
    organizationId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalance> {
    const existing = await this.em.findOne(LeaveBalance, {
      organization: organizationId,
      user: userId,
      year,
    });
    if (existing) return existing;

    const created = this.em.create(LeaveBalance, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      user: this.em.getReference(User, userId, { wrapped: true }),
      year,
      entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
      carryOverDays: 0,
      carryOverExpiresOn: null,
      takenDays: 0,
    });
    await this.em.flush();

    return created;
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

    const holidays = await this.holidayDates(organizationId, `${year}-01-01`, `${year}-12-31`);

    return round(
      requests.reduce(
        (total, request) => total + (absenceCostByYear(request, holidays).get(year) ?? 0),
        0,
      ),
    );
  }

  /** Approved becomes taken once the last day has passed, in the subject's own zone. */
  private async settleTaken(organizationId: string, requests: AbsenceRequest[]): Promise<void> {
    const stale = requests.filter((request) => request.status === 'approved');
    if (stale.length === 0) return;

    const timezone = await this.organizationTimezone(organizationId);
    const today = localDate(timezone);
    let changed = false;

    for (const request of stale) {
      if (request.endsOn < today) {
        request.status = 'taken';
        changed = true;
      }
    }

    if (changed) await this.em.flush();
  }

  /** Refuses a second absence over days already spoken for. */
  private async assertFree(
    organizationId: string,
    userId: string,
    startsOn: string,
    endsOn: string,
  ): Promise<void> {
    const clashing = await this.em.find(AbsenceRequest, {
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
    organizationId: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const holidays = await this.listHolidays(organizationId, from, to);

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

    return resolveTimezone(user?.timezone ?? null, await this.organizationTimezone(caller.organizationId));
  }

  private async organizationTimezone(organizationId: string): Promise<string> {
    const organization = await this.em.findOne(Organization, { id: organizationId });

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
