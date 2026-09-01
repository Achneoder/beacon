import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  addDays,
  dayBalance,
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
  type ClockOutRequest,
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
import { lockAdvisory } from '../../common/db/advisory-lock.js';
import { AbsencesService } from '../absences/absences.service.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AttendanceCorrection } from './attendance-correction.entity.js';
import { AttendanceDay } from './attendance-day.entity.js';
import { AttendanceEntry } from './attendance-entry.entity.js';
import { BreakEntry } from './break-entry.entity.js';
import { WorkSchedule } from './work-schedule.entity.js';
import { fallbackSchedule, scheduleInForce, toScheduleSummary } from './schedules.js';
import { ensureOvertimeBalance } from './overtime.js';

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

/** Namespace for the correction decide lock — see {@link lockAdvisory}. */
const CORRECTION_DECIDE_LOCK = 20_260_006;

/**
 * Namespace for the self-approval lock. Keyed on the person and the day rather than
 * on a correction id, because a self-approved correction is created and applied in
 * one transaction and so has no row a second request could collide on. What has to
 * serialize is the day's balance: two corrections landing together would otherwise
 * both recompute it from the same stale figure and one of the two moves would be
 * lost.
 */
const CORRECTION_SELF_APPROVE_LOCK = 20_260_007;

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

  /**
   * Closing the entry, and any break still running inside it.
   *
   * The entry and the balance move commit together: a clock-out that committed the
   * entry and then failed its balance flush would leave the day finished but the
   * bank stale, with no second chance short of a correction.
   *
   * `request.at` lets a client close the entry at an instant that has already passed —
   * the desktop app replaying a standby it could not report before the machine slept.
   * It is bounded rather than trusted: see {@link resolveClockOutAt}.
   */
  async clockOut(caller: Caller, request: ClockOutRequest = {}): Promise<TodayStatus> {
    await this.em.transactional(async (em) => {
      const entry = await this.requireOpenEntry(caller, em);
      const at = resolveClockOutAt(request.at, entry.startedAt);

      for (const pause of entry.breaks) {
        // A break cannot end before it began. It also cannot have started after `at`,
        // since `at` is at or after the entry's own start and the break sits inside
        // it — but clamping is cheaper than trusting that as the code moves.
        if (!pause.endedAt) pause.endedAt = pause.startedAt > at ? pause.startedAt : at;
      }
      entry.endedAt = at;

      await em.flush();
      await this.recomputeBalance(caller, entry.localDate, em);
    });

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
    const holidays = await this.holidaysBetween(caller.organizationId, date, date);

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
      targetMinutes: holidays.has(date) ? 0 : targetMinutesFor(schedule, weekdayOf(date)),
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
    // A public holiday expects nothing, the same rule the attendance report already
    // applies — see `foldUser` in `reports.service.ts`. Without it, a week containing
    // one prints a full target and books the day as a shortfall nobody could have
    // worked off.
    const holidays = await this.holidaysBetween(caller.organizationId, monday, dates[6]);
    // Every schedule row the week can need, in one query; the effective-dating
    // decision stays in `scheduleInForce` so this agrees with the reports by
    // construction. Seven `findOne`s here was the per-person cousin of the
    // per-organization explosion the reports module already documented.
    const scheduleRows = await this.em.find(
      WorkSchedule,
      {
        organization: caller.organizationId,
        user: subjectId,
        effectiveFrom: { $lte: dates[6] },
      },
      { orderBy: { effectiveFrom: 'desc' } },
    );

    const days: TimesheetDay[] = [];
    for (const date of dates) {
      const forDay = entries.filter((entry) => entry.localDate === date);
      const segments = forDay.flatMap((entry) => toSegments(entry));
      const totals = totalsOf(segments);
      const schedule = scheduleInForce(scheduleRows, date);
      const holiday = holidays.get(date) ?? null;
      const targetMinutes = holiday ? 0 : targetMinutesFor(schedule, weekdayOf(date));
      const bounds = forDay
        .map((entry) => entry.startedAt.getTime())
        .sort((left, right) => left - right);

      const absence = coverage.get(date) ?? null;
      // Hours worked on a holiday are pure overtime, not the target the absence would
      // otherwise have credited — matching `foldUser`'s `credited = !holiday && ...`.
      const credited = !holiday && (absence?.credited ?? false);

      days.push({
        date,
        weekday: weekdayOf(date),
        startedAt: bounds.length ? new Date(bounds[0]).toISOString() : null,
        endedAt: closingInstant(forDay),
        ...totals,
        targetMinutes,
        balanceMinutes: dayBalance(totals.workedMinutes, targetMinutes, credited),
        absenceTag: absence?.tag ?? null,
        credited,
        holiday,
        hasPendingCorrection: pendingDates.has(date),
        // A correction amends this entry only when it is the day's only one — see
        // the field's doc comment in `@beacon/shared`.
        entryId: forDay.length === 1 ? forDay[0].id : null,
      });
    }

    const balance = await ensureOvertimeBalance(this.em, caller.organizationId, subjectId);
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
      // Copy, not authorization: what a correction actually does is decided in
      // `requestCorrection`. The timesheet asks because a plain employee holds
      // `attendance:read` but not `organization:read`.
      selfApproveCorrections: await this.selfApprovesCorrections(caller.organizationId),
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

  /**
   * Raising a correction — or, where the organization allows it, simply making the
   * change.
   *
   * `Organization.selfApproveCorrections` does not open a second write path. The
   * correction row is still the only thing that changes a timesheet, and it still
   * records who asked, for what, and why; all the setting decides is whether the row
   * is created `pending` for a manager or created `approved` and applied in the same
   * transaction, with the requester recorded as its own decider. So the audit trail
   * of a trust-based organization reads like an approving one's, `/approvals` never
   * shows a queue nobody intends to work, and switching the setting back off leaves
   * nothing half-applied behind.
   *
   * Deciding *someone else's* correction is unaffected and still needs
   * `attendance:approve` — see {@link decideCorrection}, which continues to refuse a
   * caller their own row. Self-approval is a standing organization-level decision,
   * not a permission an employee can exercise over the approval queue.
   */
  async requestCorrection(
    caller: Caller,
    dto: CreateCorrectionRequest,
  ): Promise<CorrectionSummary> {
    const timezone = await this.timezoneOf(caller);

    if (dto.kind !== 'add' && !dto.entryId) {
      throw new BadRequestException('amending or removing needs an entry');
    }

    const startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    const endedAt = dto.endedAt ? new Date(dto.endedAt) : null;
    if (dto.kind !== 'remove') {
      if (!startedAt || !endedAt) throw new BadRequestException('a start and an end are required');
      if (endedAt <= startedAt) throw new BadRequestException('the end must follow the start');
    }

    // Every read below goes through the fork: the entry and the user are the rows the
    // correction is built from, and reading them through `this.em` would both leave
    // them outside the transaction and hand `em.create` entities another
    // EntityManager owns.
    return this.em.transactional(async (em) => {
      // Read inside the transaction, so the setting a correction is created under is
      // the one that was in force when it was written.
      const selfApproved = await this.selfApprovesCorrections(caller.organizationId, em);

      const entry = dto.entryId
        ? await em.findOne(
            AttendanceEntry,
            { id: dto.entryId, organization: caller.organizationId, user: caller.id },
            // An amendment restates the day's breaks, and `removeAll` only deletes
            // the pauses it can see.
            { populate: ['breaks'] },
          )
        : null;
      if (dto.entryId && !entry) throw new NotFoundException('entry not found');

      const day = localDate(timezone, startedAt ?? entry?.startedAt ?? new Date());

      if (selfApproved) {
        await lockAdvisory(em, CORRECTION_SELF_APPROVE_LOCK, `${caller.id}:${day}`);
      }

      const user = await em.findOneOrFail(User, {
        id: caller.id,
        organization: caller.organizationId,
      });

      const correction = em.create(AttendanceCorrection, {
        organization: em.getReference(Organization, caller.organizationId, { wrapped: true }),
        user: ref(user),
        entry: entry ? ref(entry) : null,
        kind: dto.kind,
        localDate: day,
        startedAt,
        endedAt,
        breakMinutes: dto.breakMinutes ?? 0,
        reason: dto.reason,
        status: selfApproved ? 'approved' : 'pending',
        // Under self-approval the requester *is* the approver — recording their
        // manager there would read as a decision that manager never made.
        approver: selfApproved ? ref(user) : user.manager,
        decidedBy: selfApproved ? ref(user) : null,
        decidedAt: selfApproved ? new Date() : null,
      });

      await em.flush();

      if (selfApproved) {
        // The same order `decideCorrection` uses: the timesheet write and the balance
        // move commit with the decision, so a failure in either cannot leave the day
        // changed and the bank stale.
        await this.applyCorrection(em, correction);
        await em.flush();
        await this.recomputeBalance(caller, day, em);
      }

      await em.populate(correction, ['user', 'approver']);

      return toCorrectionSummary(correction);
    });
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
   *
   * The status transition and the timesheet write serialize on an advisory lock:
   * two concurrent approvals would otherwise both pass the pending check and write
   * the change through twice — two entries for one approved correction.
   */
  async decideCorrection(
    caller: Caller,
    correctionId: string,
    approved: boolean,
    note?: string | null,
  ): Promise<CorrectionSummary> {
    const decided = await this.em.transactional(async (em) => {
      await lockAdvisory(em, CORRECTION_DECIDE_LOCK, correctionId);

      const correction = await em.findOne(
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
      correction.decidedBy = em.getReference(User, caller.id, { wrapped: true });
      correction.decisionNote = note ?? null;

      if (approved) await this.applyCorrection(em, correction);

      await em.flush();

      // The balance move is part of the same transaction as the decision: an
      // approval whose balance flush failed used to leave the timesheet changed
      // and the bank not, with no retry that would not double-count.
      if (approved) {
        await this.recomputeBalance({ ...caller, id: correction.user.id }, correction.localDate, em);
      }

      return {
        summary: toCorrectionSummary(correction),
        localDate: correction.localDate,
        userId: correction.user.id,
      };
    });

    return decided.summary;
  }

  /** The schedule, as the Profile screen's *Work model* card reads it. */
  async scheduleOf(caller: Caller, userId?: string): Promise<WorkScheduleSummary> {
    const subjectId = await this.resolveSubject(caller, userId);
    const timezone = await this.timezoneOf(caller, subjectId);

    return this.scheduleFor(caller.organizationId, subjectId, localDate(timezone));
  }

  // ---------------------------------------------------------------- internals

  private async applyCorrection(em: EntityManager, correction: AttendanceCorrection): Promise<void> {
    const entry = correction.entry?.getEntity() ?? null;

    if (correction.kind === 'remove') {
      if (entry) em.remove(entry);
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
      this.addBreakOfMinutes(em, correction, entry);
      return;
    }

    const added = em.create(AttendanceEntry, {
      organization: correction.organization,
      user: correction.user,
      startedAt: correction.startedAt!,
      endedAt: correction.endedAt,
      localDate: correction.localDate,
      source: 'manual',
      note: correction.reason,
      approvalStatus: 'approved',
    });
    this.addBreakOfMinutes(em, correction, added);
  }

  /**
   * A correction states a break as a total, not as clock times — nobody remembers
   * when last Tuesday's lunch started. It is materialised at the front of the entry
   * so the minutes are subtracted exactly once.
   */
  private addBreakOfMinutes(
    em: EntityManager,
    correction: AttendanceCorrection,
    entry: AttendanceEntry,
  ): void {
    if (correction.breakMinutes <= 0) return;

    const startedAt = correction.startedAt!;
    em.create(BreakEntry, {
      organization: correction.organization,
      entry: ref(entry),
      startedAt,
      endedAt: new Date(startedAt.getTime() + correction.breakMinutes * 60_000),
    });
  }

  private async openEntry(
    caller: Caller,
    em: EntityManager = this.em,
  ): Promise<AttendanceEntry | null> {
    return em.findOne(
      AttendanceEntry,
      { organization: caller.organizationId, user: caller.id, endedAt: null },
      { populate: ['breaks'] },
    );
  }

  private async requireOpenEntry(caller: Caller, em?: EntityManager): Promise<AttendanceEntry> {
    const entry = await this.openEntry(caller, em);
    if (!entry) throw new BadRequestException('you are not clocked in');

    return entry;
  }

  private async entriesBetween(
    organizationId: string,
    userId: string,
    from: string,
    to: string,
    em: EntityManager = this.em,
  ): Promise<AttendanceEntry[]> {
    return em.find(
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
   * The organization's public holidays in a span, keyed by date.
   *
   * Attendance used not to consult this at all — a week containing Christmas printed
   * a full target and booked the day as a shortfall. `AbsencesService.listHolidays` is
   * the one place the calendar is read; the report already reads it the same way.
   */
  private async holidaysBetween(
    organizationId: string,
    from: string,
    to: string,
    em: EntityManager = this.em,
  ): Promise<Map<string, string>> {
    const holidays = await this.absences.listHolidays(organizationId, from, to, em);

    return new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
  }

  /**
   * The schedule in force on `date`, or a full-time default. Effective dating means
   * the newest row that started on or before the day wins — a decision
   * {@link scheduleInForce} owns, so the report resolving a quarter in memory and the
   * timesheet resolving one day from the database cannot drift apart.
   */
  private async scheduleFor(
    organizationId: string,
    userId: string,
    date: string,
    em: EntityManager = this.em,
  ): Promise<WorkScheduleSummary> {
    const schedule = await em.findOne(
      WorkSchedule,
      { organization: organizationId, user: userId, effectiveFrom: { $lte: date } },
      { orderBy: { effectiveFrom: 'desc' } },
    );

    return schedule ? toScheduleSummary(schedule) : fallbackSchedule(date);
  }

  /**
   * Fold a finished day into the running balance.
   *
   * The day is recomputed from its entries and the balance moves by the difference
   * against what that day last contributed — the figure kept on {@link AttendanceDay}.
   * An incremental `+= worked` would double-count the moment a correction amended a
   * day that had already been counted.
   *
   * Every query runs through the `em` it is given: the callers that hold a
   * transaction (`clockOut`, `decideCorrection`) pass its fork, and a read through
   * `this.em` from inside one would run outside it.
   */
  private async recomputeBalance(
    caller: Caller,
    date: string,
    em: EntityManager = this.em,
  ): Promise<void> {
    const entries = await this.entriesBetween(caller.organizationId, caller.id, date, date, em);
    const { workedMinutes } = totalsOf(entries.flatMap((entry) => toSegments(entry)));
    const schedule = await this.scheduleFor(caller.organizationId, caller.id, date, em);
    // A public holiday expects nothing — see `holidaysBetween` — so hours worked on
    // one bank as pure overtime rather than as a shortfall nobody could have worked
    // off, the same rule `week()` and the attendance report apply.
    const holidays = await this.holidaysBetween(caller.organizationId, date, date, em);
    const holiday = holidays.has(date);
    const targetMinutes = holiday ? 0 : targetMinutesFor(schedule, weekdayOf(date));
    // A credited day met its target through the absence, not through worked time, so
    // it must not book a full day of negative balance against the person who was off.
    const coverage = await this.absences.coverageOf(
      caller.organizationId,
      caller.id,
      date,
      date,
      em,
    );
    const credited = !holiday && (coverage.get(date)?.credited ?? false);
    const balanceMinutes = dayBalance(workedMinutes, targetMinutes, credited);

    let day = await em.findOne(AttendanceDay, {
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
      day = em.create(AttendanceDay, {
        organization: em.getReference(Organization, caller.organizationId, { wrapped: true }),
        user: em.getReference(User, caller.id, { wrapped: true }),
        localDate: date,
        workedMinutes,
        targetMinutes,
        balanceMinutes,
      });
    }

    const balance = await ensureOvertimeBalance(em, caller.organizationId, caller.id);
    balance.balanceMinutes += balanceMinutes - previous;

    await em.flush();
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

  /**
   * Whether this organization applies a person's own correction without a decision.
   *
   * Absent for any reason it reads false — the arrangement the correction flow was
   * built around. A missing organization row is not a licence to skip approval.
   */
  private async selfApprovesCorrections(
    organizationId: string,
    em: EntityManager = this.em,
  ): Promise<boolean> {
    const organization = await em.findOne(Organization, { id: organizationId });

    return organization?.selfApproveCorrections ?? false;
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

/**
 * The instant a clock-out closes at, bounded so a client cannot invent one.
 *
 * A client-supplied `at` is only ever a *correction downwards* — the desktop app
 * saying "the machine actually went to sleep at 17:02, not now". So it may not run
 * ahead of the server's clock by more than the drift two machines legitimately have,
 * and it may not precede the clock-in, which would produce a negative day.
 *
 * Exported for the unit test: the rule is worth pinning down without a database.
 */
export function resolveClockOutAt(at: string | undefined, startedAt: Date, now = new Date()): Date {
  if (at === undefined) return now;

  const instant = new Date(at);

  if (Number.isNaN(instant.getTime())) {
    throw new BadRequestException('at must be a valid instant');
  }
  if (instant.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) {
    throw new BadRequestException('a clock-out cannot be in the future');
  }
  if (instant.getTime() < startedAt.getTime()) {
    throw new BadRequestException('a clock-out cannot precede the clock-in');
  }

  // Inside the tolerance but still ahead of the server: accept the clock-out, but
  // record the server's own instant. Storing the future would leave a segment that
  // reads as still running for the next few seconds.
  return instant.getTime() > now.getTime() ? now : instant;
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
