import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser, TimeEntrySummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { optionalUuid } from '../../common/http/optional-uuid.pipe.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { TimeEntriesService, type Caller } from './time-entries.service.js';
import { StartTimerDto } from './dto/start-timer.dto.js';
import { CreateManualTimeEntryDto } from './dto/create-manual-time-entry.dto.js';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto.js';

/**
 * Every route here is self-scoped — there is no `userId` query param the way
 * attendance offers one, because a time entry has no approver and no manager view in
 * this phase. Seeing everyone's booked time is `report:read`'s job, on
 * `GET /reports/time/summary`.
 */
@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly timeEntries: TimeEntriesService) {}

  @Get()
  @RequirePermissions('time:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectId', optionalUuid) projectId?: string,
  ): Promise<TimeEntrySummary[]> {
    return this.timeEntries.listMine(callerOf(user), { from, to, projectId });
  }

  /**
   * `@Res()` without `passthrough` — Nest's default reply path collapses a `null`
   * return into an empty 200 body (`isNil` treats `null` and `undefined` alike), which
   * `response.json()` on the other end cannot parse. 204 is the honest status for
   * "nothing running", and the web client already treats 204 as `undefined`.
   */
  @Get('running')
  @RequirePermissions('time:read')
  async running(@CurrentUser() user: AuthenticatedUser, @Res() response: Response): Promise<void> {
    const entry = await this.timeEntries.runningOf(callerOf(user));

    if (entry) response.status(200).json(entry);
    else response.status(204).send();
  }

  @Post('start')
  @RequirePermissions('time:write')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartTimerDto,
  ): Promise<TimeEntrySummary> {
    return this.timeEntries.start(callerOf(user), dto);
  }

  @Post(':id/stop')
  @RequirePermissions('time:write')
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TimeEntrySummary> {
    return this.timeEntries.stop(callerOf(user), id);
  }

  @Post()
  @RequirePermissions('time:write')
  createManual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateManualTimeEntryDto,
  ): Promise<TimeEntrySummary> {
    return this.timeEntries.createManual(callerOf(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('time:write')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTimeEntryDto,
  ): Promise<TimeEntrySummary> {
    return this.timeEntries.update(callerOf(user), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('time:write')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.timeEntries.remove(callerOf(user), id);
  }
}

function callerOf(user: AuthenticatedUser): Caller {
  return { id: user.id, organizationId: user.organizationId };
}
