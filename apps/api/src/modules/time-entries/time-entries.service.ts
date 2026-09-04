import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import {
  addDays,
  amountFor,
  effectiveHourlyRate,
  minutesBetween,
  type CreateManualTimeEntryRequest,
  type StartTimerRequest,
  type TimeEntrySummary,
  type UpdateTimeEntryRequest,
} from '@beacon/shared';
import { localDate, resolveTimezone } from '../../common/time/zone.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { ProjectsService } from '../projects/projects.service.js';
import { TimeEntry } from './time-entry.entity.js';

/** Every route is self-scoped, so unlike attendance's `Caller` there is no `canApprove`. */
export interface Caller {
  id: string;
  organizationId: string;
}

export interface TimeEntryFilter {
  from?: string;
  to?: string;
  projectId?: string;
}

@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly em: EntityManager,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Opening a timer. Two running timers would make "how long has this been running"
   * ambiguous the same way a second clock-in would, so a running one is refused
   * outright — the partial unique index on the entity is the second line of defense
   * against a race, the same shape `AttendanceService.clockIn` relies on.
   */
  async start(caller: Caller, dto: StartTimerRequest): Promise<TimeEntrySummary> {
    if (await this.runningEntry(caller)) {
      throw new BadRequestException('you already have a timer running');
    }

    const project = await this.projects.findBookableProjectOrThrow(caller.organizationId, dto.projectId);
    const task = dto.taskId
      ? await this.projects.findBookableTaskOrThrow(caller.organizationId, dto.projectId, dto.taskId)
      : null;

    const now = new Date();
    const timezone = await this.timezoneOf(caller);

    const entry = this.em.create(TimeEntry, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      user: this.em.getReference(User, caller.id, { wrapped: true }),
      project: ref(project),
      task: task ? ref(task) : null,
      localDate: localDate(timezone, now),
      startedAt: now,
      endedAt: null,
      durationMinutes: null,
      billable: true,
      // Frozen at creation — never re-read once the timer is running.
      rateAtEntry: effectiveHourlyRate(project, task),
      amount: null,
      source: 'timer',
      note: dto.note ?? null,
    });
    await this.em.flush();

    return toTimeEntrySummary(entry);
  }

  /** Freezes `durationMinutes` and `amount` the moment the timer stops. */
  async stop(caller: Caller, id: string): Promise<TimeEntrySummary> {
    const entry = await this.findOwn(caller, id);
    if (!entry.startedAt || entry.endedAt) {
      throw new BadRequestException('that timer is not running');
    }

    const now = new Date();
    entry.endedAt = now;
    entry.durationMinutes = minutesBetween(entry.startedAt, now);
    entry.amount = amountOf(entry.billable, entry.rateAtEntry, entry.durationMinutes);

    await this.em.flush();

    return toTimeEntrySummary(entry);
  }

  async createManual(caller: Caller, dto: CreateManualTimeEntryRequest): Promise<TimeEntrySummary> {
    const { durationMinutes, startedAt, endedAt } = resolveManualDuration(dto);

    const project = await this.projects.findBookableProjectOrThrow(caller.organizationId, dto.projectId);
    const task = dto.taskId
      ? await this.projects.findBookableTaskOrThrow(caller.organizationId, dto.projectId, dto.taskId)
      : null;

    const billable = dto.billable ?? true;
    const rateAtEntry = effectiveHourlyRate(project, task);

    const entry = this.em.create(TimeEntry, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      user: this.em.getReference(User, caller.id, { wrapped: true }),
      project: ref(project),
      task: task ? ref(task) : null,
      localDate: dto.localDate,
      startedAt,
      endedAt,
      durationMinutes,
      billable,
      rateAtEntry,
      amount: amountOf(billable, rateAtEntry, durationMinutes),
      source: 'manual',
      note: dto.note ?? null,
    });
    await this.em.flush();

    return toTimeEntrySummary(entry);
  }

  /**
   * Own entry only — 404s on anyone else's, the same as a plain self-service resource
   * with no `resolveSubject` widening. Reassigning the project/task never re-resolves
   * `rateAtEntry`: a rate change is a new booking, not a rewrite of an old one.
   */
  async update(caller: Caller, id: string, dto: UpdateTimeEntryRequest): Promise<TimeEntrySummary> {
    const entry = await this.findOwn(caller, id);

    if (dto.projectId !== undefined && dto.projectId !== entry.project.id) {
      const project = await this.projects.findBookableProjectOrThrow(caller.organizationId, dto.projectId);
      entry.project = ref(project);
    }
    if (dto.taskId !== undefined) {
      entry.task = dto.taskId
        ? ref(
            await this.projects.findBookableTaskOrThrow(
              caller.organizationId,
              entry.project.id,
              dto.taskId,
            ),
          )
        : null;
    }
    if (dto.localDate !== undefined) entry.localDate = dto.localDate;
    if (dto.note !== undefined) entry.note = dto.note;
    if (dto.billable !== undefined) entry.billable = dto.billable;

    if (dto.durationMinutes !== undefined || dto.startedAt !== undefined || dto.endedAt !== undefined) {
      if (entry.startedAt && !entry.endedAt) {
        throw new BadRequestException('stop the timer before editing its duration');
      }
      const resolved = resolveManualDuration({
        durationMinutes: dto.durationMinutes,
        startedAt: dto.startedAt,
        endedAt: dto.endedAt,
      });
      entry.durationMinutes = resolved.durationMinutes;
      entry.startedAt = resolved.startedAt;
      entry.endedAt = resolved.endedAt;
    }

    entry.amount = amountOf(entry.billable, entry.rateAtEntry, entry.durationMinutes);

    await this.em.flush();

    return toTimeEntrySummary(entry);
  }

  /** No audit-trail requirement here, unlike a locked attendance week — self-owned data. */
  async remove(caller: Caller, id: string): Promise<void> {
    const entry = await this.findOwn(caller, id);
    await this.em.removeAndFlush(entry);
  }

  async listMine(caller: Caller, filter: TimeEntryFilter = {}): Promise<TimeEntrySummary[]> {
    const timezone = await this.timezoneOf(caller);
    const to = filter.to ?? localDate(timezone);
    const from = filter.from ?? addDays(to, -30);

    const entries = await this.em.find(
      TimeEntry,
      {
        organization: caller.organizationId,
        user: caller.id,
        localDate: { $gte: from, $lte: to },
        ...(filter.projectId ? { project: filter.projectId } : {}),
      },
      { populate: ['project', 'task'], orderBy: { localDate: 'desc', startedAt: 'desc' } },
    );

    return entries.map(toTimeEntrySummary);
  }

  async runningOf(caller: Caller): Promise<TimeEntrySummary | null> {
    const entry = await this.runningEntry(caller);

    return entry ? toTimeEntrySummary(entry) : null;
  }

  // ---------------------------------------------------------------- internals

  private async runningEntry(caller: Caller): Promise<TimeEntry | null> {
    return this.em.findOne(
      TimeEntry,
      { organization: caller.organizationId, user: caller.id, startedAt: { $ne: null }, endedAt: null },
      { populate: ['project', 'task'] },
    );
  }

  private async findOwn(caller: Caller, id: string): Promise<TimeEntry> {
    const entry = await this.em.findOne(
      TimeEntry,
      { id, organization: caller.organizationId, user: caller.id },
      { populate: ['project', 'task'] },
    );
    if (!entry) throw new NotFoundException('time entry not found');

    return entry;
  }

  private async timezoneOf(caller: Caller): Promise<string> {
    const user = await this.em.findOne(
      User,
      { id: caller.id, organization: caller.organizationId },
      { fields: ['timezone'] },
    );
    const organization = await this.em.findOne(Organization, { id: caller.organizationId });

    return resolveTimezone(user?.timezone ?? null, organization?.timezone ?? 'UTC');
  }
}

/** `amount` is only ever the frozen rate times the frozen duration — never a live read. */
function amountOf(billable: boolean, rateAtEntry: number | null, durationMinutes: number | null): number | null {
  if (!billable || rateAtEntry === null || durationMinutes === null) return null;

  return amountFor(durationMinutes, rateAtEntry);
}

/**
 * A manual booking gives exactly one of `durationMinutes` or a `startedAt`/`endedAt`
 * pair — never both, never neither. Exported so the rule is tested without a database.
 */
export function resolveManualDuration(dto: {
  durationMinutes?: number;
  startedAt?: string;
  endedAt?: string;
}): { durationMinutes: number; startedAt: Date | null; endedAt: Date | null } {
  const hasDuration = dto.durationMinutes !== undefined;
  const hasRange = dto.startedAt !== undefined || dto.endedAt !== undefined;

  if (hasDuration === hasRange) {
    throw new BadRequestException('give either a duration or a start and end, not both');
  }

  if (hasDuration) {
    if (dto.durationMinutes! <= 0) throw new BadRequestException('duration must be positive');

    return { durationMinutes: dto.durationMinutes!, startedAt: null, endedAt: null };
  }

  if (dto.startedAt === undefined || dto.endedAt === undefined) {
    throw new BadRequestException('a start and an end are required');
  }

  const startedAt = new Date(dto.startedAt);
  const endedAt = new Date(dto.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new BadRequestException('start and end must be valid instants');
  }
  if (endedAt <= startedAt) throw new BadRequestException('the end must follow the start');

  return { durationMinutes: minutesBetween(startedAt, endedAt), startedAt, endedAt };
}

/** Requires `project` and `task` to be populated. */
export function toTimeEntrySummary(entry: TimeEntry): TimeEntrySummary {
  const project = entry.project.getEntity();
  const task = entry.task?.getEntity() ?? null;

  return {
    id: entry.id,
    projectId: project.id,
    projectName: project.name,
    taskId: task?.id ?? null,
    taskName: task?.name ?? null,
    userId: entry.user.id,
    localDate: entry.localDate,
    startedAt: entry.startedAt?.toISOString() ?? null,
    endedAt: entry.endedAt?.toISOString() ?? null,
    durationMinutes: entry.durationMinutes,
    billable: entry.billable,
    rateAtEntry: entry.rateAtEntry,
    amount: entry.amount,
    source: entry.source,
    note: entry.note,
  };
}
