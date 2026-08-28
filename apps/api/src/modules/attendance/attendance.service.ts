import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import {
  addDays,
  dayBalance,
  defaultExpectedMinutes,
  fullName,
  isWeekLocked,
  minutesBetween,
  startOfWeek,
  summarizeOvertime,
  targetMinutesFor,
  totalsOf,
  weekDates,
  weekLocksAt,
  weekdayOf,
  type AttendanceSegment,
  type ClockRequest,
  type ClockState,
  type CorrectionSummary,
  type CreateCorrectionRequest,
  type TimesheetDay,
  type TimesheetWeek,
  type TodayStatus,
  type WorkScheduleSummary,
} from '@beacon/shared';
import { localDate, offsetMinutes, resolveTimezone } from '../../common/time/zone.js';
import { AbsencesService } from '../absences/absences.service.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AttendanceCorrection } from './attendance-correction.entity.js';
import { AttendanceDay } from './attendance-day.entity.js';
import { AttendanceEntry } from './attendance-entry.entity.js';
import { BreakEntry } from './break-entry.entity.js';
import { OvertimeBalance } from './overtime-balance.entity.js';
import { WorkSchedule } from './work-schedule.entity.js';

/** The weekly hours a person gets until someone gives them a schedule of their own. */
const FALLBACK_WEEKLY_MINUTES = 40 * 60;

export interface AttendanceRangeFilter {
  userId?: string;
  from?: string;
  to?: string;
}

/** Who the caller is, and what the guard already let through. */
export interface Caller {
  id: string;
  organizationId: string;
  /** True when the caller holds `attendance:approve` — they may read everyone. */
  canApprove: boolean;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly em: EntityManager,
    private readonly users: UsersService,
    private readonly absences: AbsencesService,
  ) {}

  // ---------------------------------------------------------------- the clock

  /**
   * Opening an entry. Two open entries would make "how long have I been working"
   * unanswerable, so a second clock-in is refused rather than silently closing the
   * first — the earlier one may be a forgotten clock-out that needs a correction.
   */
  async clockIn(caller: Caller, request: ClockRequest = {}): Promise<TodayStatus> {
    if (await this.openEntry(caller)) {
      throw new BadRequestException('you are already clocked in');
    }

    const now = new Date();
    const timezone = await this.timezoneOf(caller);

    this.em.create(AttendanceEntry, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      user: this.em.getReference(User, caller.id, { wrapped: true }),
      startedAt: now,
      localDate: localDate(timezone, now),
      source: request.source ?? 'web',
      note: request.note ?? null,
      approvalStatus: 'approved',
    });

    await this.em.flush();

    return this.today(caller);
  }

  /** Closing the entry, and any break still running inside it. */
  async clockOut(caller: Caller): Promise<TodayStatus> {
    const entry = await this.requireOpenEntry(caller);
    const now = new Date();

    for (const pause of entry.breaks) {
      if (!pause.endedAt) pause.endedAt = now;
    }
    entry.endedAt = now;

    await this.em.flush();
    await this.recomputeBalance(caller, entry.localDate);

    return this.today(caller);
  }

  async startBreak(caller: Caller): Promise<TodayStatus> {
    const entry = await this.requireOpenEntry(caller);
    if (entry.breaks.getItems().some((pause) => !pause.endedAt)) {
      throw new BadRequestException('you are already on a break');
    }

    this.em.create(BreakEntry, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      entry: ref(entry),
      startedAt: new Date(),
    });

    await this.em.flush();

    return this.today(caller);
  }

  async stopBreak(caller: Caller): Promise<TodayStatus> {
    const entry = await this.requireOpenEntry(caller);
    const running = entry.breaks.getItems().find((pause) => !pause.endedAt);
    if (!running) throw new BadRequestException('you are not on a break');

    running.endedAt = new Date();

    await this.em.flush();

    return this.today(caller);
  }

  // ---------------------------------------------------------------- reading

  async today(caller: Caller): Promise<TodayStatus> {
    const timezone = await this.timezoneOf(caller);
    const date = localDate(timezone);
    const entries = await this.entriesBetween(caller.organizationId, caller.id, date, date);
    const segments = entries.flatMap((entry) => toSegments(entry));
    const totals = totalsOf(segments);
    const schedule = await this.scheduleFor(caller.organizationId, caller.id, date);

    const open = entries.find((entry) => !entry.endedAt);
    const pause = open?.breaks.getItems().find((item) => !item.endedAt);
    const state: ClockState = pause ? 'break' : open ? 'in' : 'out';

    return {
      timezone,
      date,
      state,
      since: (pause?.startedAt ?? open?.startedAt ?? null)?.toISOString() ?? null,
      segments,
      ...totals,
      targetMinutes: targetMinutesFor(schedule, weekdayOf(date)),
    };
  }

  /**
   * A week of the timesheet. `offset` is relative to the week containing today —
   * `0` is this week, `-1` the one before — so the client pages without doing date
   * arithmetic in a zone it may not share with the user.
   */
  async week(caller: Caller, offset = 0, userId?: string): Promise<TimesheetWeek> {
    const subjectId = await this.resolveSubject(caller, userId);
    const timezone = await this.timezoneOf(caller, subjectId);
    const monday = addDays(startOfWeek(localDate(timezone)), offset * 7);
    const dates = weekDates(monday);

    const entries = await this.entriesBetween(
      caller.organizationId,
      subjectId,
      monday,
      dates[6],
    );
    const pending = await this.em.find(AttendanceCorrection, {
      organization: caller.organizationId,
      user: subjectId,
      status: 'pending',
      localDate: { $gte: monday, $lte: dates[6] },
    });
    const pendingDates = new Set(pending.map((correction) => correction.localDate));
    // The absence tag and the credited flag are one decision, made in one place —
    // the calendar tints a cell from the same rows this reads.
    const coverage = await this.absences.coverageOf(
      caller.organizationId,
      subjectId,
      monday,
      dates[6],
    );

    const days: TimesheetDay[] = [];
    for (const date of dates) {
      const forDay = entries.filter((entry) => entry.localDate === date);
      const segments = forDay.flatMap((entry) => toSegments(entry));
      const totals = totalsOf(segments);
      const schedule = await this.scheduleFor(caller.organizationId, subjectId, date);
      const targetMinutes = targetMinutesFor(schedule, weekdayOf(date));
      const bounds = forDay
        .map((entry) => entry.startedAt.getTime())
        .sort((left, right) => left - right);

      const absence = coverage.get(date) ?? null;

      days.push({
        date,
        weekday: weekdayOf(date),
        startedAt: bounds.length ? new Date(bounds[0]).toISOString() : null,
        endedAt: closingInstant(forDay),
        ...totals,
        targetMinutes,
        balanceMinutes: dayBalance(totals.workedMinutes, targetMinutes, absence?.credited ?? false),
        absenceTag: absence?.tag ?? null,
        credited: absence?.credited ?? false,
        hasPendingCorrection: pendingDates.has(date),
      });
    }

    const balance = await this.balanceOf(caller.organizationId, subjectId);
    const offsetForZone = offsetMinutes(timezone, new Date());

    return {
      from: monday,
      to: dates[6],
      offset,
      timezone,
      days,
      workedMinutes: sum(days, (day) => day.workedMinutes),
      breakMinutes: sum(days, (day) => day.breakMinutes),
      targetMinutes: sum(days, (day) => day.targetMinutes),
      balanceMinutes: sum(days, (day) => day.balanceMinutes),
      overtime: summarizeOvertime(balance.balanceMinutes, balance.capMinutes),
      locked: isWeekLocked(monday, new Date(), offsetForZone),
      locksAt: weekLocksAt(monday, offsetForZone).toISOString(),
    };
  }

  /**
   * The raw segments for a range. Reading someone else's is allowed for their manager
   * and for anyone holding `attendance:approve`; everyone else sees only themselves.
   */
  async range(caller: Caller, filter: AttendanceRangeFilter): Promise<AttendanceSegment[]> {
    const subjectId = await this.resolveSubject(caller, filter.userId);
    const timezone = await this.timezoneOf(caller, subjectId);
    const to = filter.to ?? localDate(timezone);
    const from = filter.from ?? addDays(to, -30);

    const entries = await this.entriesBetween(caller.organizationId, subjectId, from, to);

    return entries.flatMap((entry) => toSegments(entry));
  }

  // ---------------------------------------------------------------- corrections

  async requestCorrection(
    caller: Caller,
    dto: CreateCorrectionRequest,
  ): Promise<CorrectionSummary> {
    const timezone = await this.timezoneOf(caller);
    const entry = dto.entryId
      ? await this.em.findOne(AttendanceEntry, {
          id: dto.entryId,
          organization: caller.organizationId,
          user: caller.id,
        })
      : null;

    if (dto.entryId && !entry) throw new NotFoundException('entry not found');
    if (dto.kind !== 'add' && !entry) {
      throw new BadRequestException('amending or removing needs an entry');
    }

    const startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    const endedAt = dto.endedAt ? new Date(dto.endedAt) : null;
    if (dto.kind !== 'remove') {
      if (!startedAt || !endedAt) throw new BadRequestException('a start and an end are required');
      if (endedAt <= startedAt) throw new BadRequestException('the end must follow the start');
    }

    const user = await this.users.findEntity(caller.organizationId, caller.id);
    const correction = this.em.create(AttendanceCorrection, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      user: ref(user),
      entry: entry ? ref(entry) : null,
      kind: dto.kind,
      localDate: localDate(timezone, startedAt ?? entry?.startedAt ?? new Date()),
      startedAt,
      endedAt,
      breakMinutes: dto.breakMinutes ?? 0,
      reason: dto.reason,
      status: 'pending',
      approver: user.manager,
    });

    await this.em.flush();
    await this.em.populate(correction, ['user', 'approver']);

    return toCorrectionSummary(correction);
  }

  /** Own requests always; a manager's queue when the caller can approve. */
  async listCorrections(caller: Caller, mine: boolean): Promise<CorrectionSummary[]> {
    const where: Record<string, unknown> = { organization: caller.organizationId };

    if (mine || !caller.canApprove) where.user = caller.id;

    const corrections = await this.em.find(AttendanceCorrection, where, {
      populate: ['user', 'approver'],
      orderBy: { createdAt: 'desc' },
    });

    return corrections.map(toCorrectionSummary);
  }

  /**
   * Approving writes the change through — the request is the audit trail, and an
   * approval that left the timesheet untouched would be a lie on the screen.
   */
  async decideCorrection(
    caller: Caller,
    correctionId: string,
    approved: boolean,
    note?: string | null,
  ): Promise<CorrectionSummary> {
    const correction = await this.em.findOne(
      AttendanceCorrection,
      { id: correctionId, organization: caller.organizationId },
      { populate: ['user', 'approver', 'entry'] },
    );
    if (!correction) throw new NotFoundException('correction not found');
    if (correction.status !== 'pending') {
      throw new BadRequestException('that request has already been decided');
    }
    if (correction.user.id === caller.id) {
      throw new ForbiddenException('you cannot decide your own correction');
    }

    correction.status = approved ? 'approved' : 'rejected';
    correction.decidedAt = new Date();
    correction.decidedBy = this.em.getReference(User, caller.id, { wrapped: true });
    correction.decisionNote = note ?? null;

    if (approved) await this.applyCorrection(correction);

    await this.em.flush();
    if (approved) {
      await this.recomputeBalance(
        { ...caller, id: correction.user.id },
        correction.localDate,
      );
    }

    return toCorrectionSummary(correction);
  }

  /** The schedule, as the Profile screen's *Work model* card reads it. */
  async scheduleOf(caller: Caller, userId?: string): Promise<WorkScheduleSummary> {
    const subjectId = await this.resolveSubject(caller, userId);
    const timezone = await this.timezoneOf(caller, subjectId);

    return this.scheduleFor(caller.organizationId, subjectId, localDate(timezone));
  }

  // ---------------------------------------------------------------- internals

  private async applyCorrection(correction: AttendanceCorrection): Promise<void> {
    const entry = correction.entry?.getEntity() ?? null;

    if (correction.kind === 'remove') {
      if (entry) this.em.remove(entry);
      return;
    }

    if (correction.kind === 'amend' && entry) {
      entry.startedAt = correction.startedAt!;
      entry.endedAt = correction.endedAt;
      entry.approvalStatus = 'approved';
      entry.localDate = correction.localDate;
      // The requested break total replaces whatever was recorded: an amendment
      // restates the day rather than patching individual pauses.
      entry.breaks.removeAll();
      this.addBreakOfMinutes(correction, entry);
      return;
    }

    const added = this.em.create(AttendanceEntry, {
      organization: correction.organization,
      user: correction.user,
      startedAt: correction.startedAt!,
      endedAt: correction.endedAt,
      localDate: correction.localDate,
      source: 'manual',
      note: correction.reason,
      approvalStatus: 'approved',
    });
    this.addBreakOfMinutes(correction, added);
  }

  /**
   * A correction states a break as a total, not as clock times — nobody remembers
   * when last Tuesday's lunch started. It is materialised at the front of the entry
   * so the minutes are subtracted exactly once.
   */
  private addBreakOfMinutes(correction: AttendanceCorrection, entry: AttendanceEntry): void {
    if (correction.breakMinutes <= 0) return;

    const startedAt = correction.startedAt!;
    this.em.create(BreakEntry, {
      organization: correction.organization,
      entry: ref(entry),
      startedAt,
      endedAt: new Date(startedAt.getTime() + correction.breakMinutes * 60_000),
    });
  }

  private async openEntry(caller: Caller): Promise<AttendanceEntry | null> {
    return this.em.findOne(
      AttendanceEntry,
      { organization: caller.organizationId, user: caller.id, endedAt: null },
      { populate: ['breaks'] },
    );
  }

  private async requireOpenEntry(caller: Caller): Promise<AttendanceEntry> {
    const entry = await this.openEntry(caller);
    if (!entry) throw new BadRequestException('you are not clocked in');

    return entry;
  }

  private async entriesBetween(
    organizationId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<AttendanceEntry[]> {
    return this.em.find(
      AttendanceEntry,
      {
        organization: organizationId,
        user: userId,
        localDate: { $gte: from, $lte: to },
        approvalStatus: { $ne: 'rejected' },
      },
      { populate: ['breaks'], orderBy: { startedAt: 'asc' } },
    );
  }

  /**
   * The schedule in force on `date`, or a full-time default. Effective dating means
   * the newest row that started on or before the day wins.
   */
  private async scheduleFor(
    organizationId: string,
    userId: string,
    date: string,
  ): Promise<WorkScheduleSummary> {
    const schedule = await this.em.findOne(
      WorkSchedule,
      { organization: organizationId, user: userId, effectiveFrom: { $lte: date } },
      { orderBy: { effectiveFrom: 'desc' } },
    );

    if (!schedule) {
      return {
        id: 'default',
        model: 'flextime',
        weeklyMinutes: FALLBACK_WEEKLY_MINUTES,
        expectedMinutes: defaultExpectedMinutes(FALLBACK_WEEKLY_MINUTES),
        coreStart: null,
        coreEnd: null,
        startTime: null,
        endTime: null,
        rosterRef: null,
        effectiveFrom: date,
      };
    }

    return {
      id: schedule.id,
      model: schedule.model,
      weeklyMinutes: schedule.weeklyMinutes,
      expectedMinutes: schedule.expectedMinutes,
      coreStart: schedule.coreStart,
      coreEnd: schedule.coreEnd,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      rosterRef: schedule.rosterRef,
      effectiveFrom: schedule.effectiveFrom,
    };
  }

  private async balanceOf(organizationId: string, userId: string): Promise<OvertimeBalance> {
    const existing = await this.em.findOne(OvertimeBalance, {
      organization: organizationId,
      user: userId,
    });
    if (existing) return existing;

    const created = this.em.create(OvertimeBalance, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      user: this.em.getReference(User, userId, { wrapped: true }),
    });
    await this.em.flush();

    return created;
  }

  /**
   * Fold a finished day into the running balance.
   *
   * The day is recomputed from its entries and the balance moves by the difference
   * against what that day last contributed — the figure kept on {@link AttendanceDay}.
   * An incremental `+= worked` would double-count the moment a correction amended a
   * day that had already been counted.
   */
  private async recomputeBalance(caller: Caller, date: string): Promise<void> {
    const entries = await this.entriesBetween(caller.organizationId, caller.id, date, date);
    const { workedMinutes } = totalsOf(entries.flatMap((entry) => toSegments(entry)));
    const schedule = await this.scheduleFor(caller.organizationId, caller.id, date);
    const targetMinutes = targetMinutesFor(schedule, weekdayOf(date));
    // A credited day met its target through the absence, not through worked time, so
    // it must not book a full day of negative balance against the person who was off.
    const coverage = await this.absences.coverageOf(
      caller.organizationId,
      caller.id,
      date,
      date,
    );
    const balanceMinutes = dayBalance(workedMinutes, targetMinutes, coverage.get(date)?.credited ?? false);

    let day = await this.em.findOne(AttendanceDay, {
      organization: caller.organizationId,
      user: caller.id,
      localDate: date,
    });

    const previous = day?.balanceMinutes ?? 0;
    if (day) {
      day.workedMinutes = workedMinutes;
      day.targetMinutes = targetMinutes;
      day.balanceMinutes = balanceMinutes;
    } else {
      day = this.em.create(AttendanceDay, {
        organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
        user: this.em.getReference(User, caller.id, { wrapped: true }),
        localDate: date,
        workedMinutes,
        targetMinutes,
        balanceMinutes,
      });
    }

    const balance = await this.balanceOf(caller.organizationId, caller.id);
    balance.balanceMinutes += balanceMinutes - previous;

    await this.em.flush();
  }

  /** Own record always; a report's or anyone's, depending on the caller's reach. */
  private async resolveSubject(caller: Caller, userId?: string): Promise<string> {
    if (!userId || userId === caller.id) return caller.id;
    if (caller.canApprove) return userId;

    const reports = await this.users.subordinateIdsOf(caller.organizationId, caller.id);
    if (!reports.includes(userId)) {
      throw new ForbiddenException('you may only read your own attendance');
    }

    return userId;
  }

  /** The subject's own zone, falling back through the organization to UTC. */
  private async timezoneOf(caller: Caller, userId?: string): Promise<string> {
    const user = await this.em.findOne(
      User,
      { id: userId ?? caller.id, organization: caller.organizationId },
      { fields: ['timezone'] },
    );
    const organization = await this.em.findOne(Organization, { id: caller.organizationId });

    return resolveTimezone(user?.timezone ?? null, organization?.timezone ?? 'UTC');
  }
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

/** The last clock-out of the day, or null while one is still running. */
function closingInstant(entries: AttendanceEntry[]): string | null {
  if (!entries.length || entries.some((entry) => !entry.endedAt)) return null;

  const last = Math.max(...entries.map((entry) => entry.endedAt!.getTime()));

  return new Date(last).toISOString();
}

/** Requires `breaks` to be populated. */
export function toSegments(entry: AttendanceEntry): AttendanceSegment[] {
  const work: AttendanceSegment = {
    id: entry.id,
    kind: 'work',
    startedAt: entry.startedAt.toISOString(),
    endedAt: entry.endedAt?.toISOString() ?? null,
    source: entry.source,
    note: entry.note,
    approvalStatus: entry.approvalStatus,
    durationMinutes: entry.endedAt ? minutesBetween(entry.startedAt, entry.endedAt) : null,
  };

  const breaks = entry.breaks.getItems().map<AttendanceSegment>((pause) => ({
    id: pause.id,
    kind: 'break',
    startedAt: pause.startedAt.toISOString(),
    endedAt: pause.endedAt?.toISOString() ?? null,
    source: entry.source,
    note: null,
    approvalStatus: entry.approvalStatus,
    durationMinutes: pause.endedAt ? minutesBetween(pause.startedAt, pause.endedAt) : null,
  }));

  return [work, ...breaks].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

/** Requires `user` and `approver` to be populated. */
export function toCorrectionSummary(correction: AttendanceCorrection): CorrectionSummary {
  const requester = correction.user.getEntity();
  const approver = correction.approver?.getEntity() ?? null;

  return {
    id: correction.id,
    kind: correction.kind,
    entryId: correction.entry?.id ?? null,
    requestedById: requester.id,
    requestedByName: fullName(requester),
    approverId: approver?.id ?? null,
    approverName: approver ? fullName(approver) : null,
    date: correction.localDate,
    startedAt: correction.startedAt?.toISOString() ?? null,
    endedAt: correction.endedAt?.toISOString() ?? null,
    breakMinutes: correction.breakMinutes,
    reason: correction.reason,
    status: correction.status,
    decidedAt: correction.decidedAt?.toISOString() ?? null,
    decisionNote: correction.decisionNote,
    createdAt: correction.createdAt.toISOString(),
  };
}
