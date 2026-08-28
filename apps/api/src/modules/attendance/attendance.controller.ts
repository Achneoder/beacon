import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type {
  AttendanceSegment,
  AuthenticatedUser,
  CorrectionSummary,
  TimesheetWeek,
  TodayStatus,
  WorkScheduleSummary,
} from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { AttendanceService, type Caller } from './attendance.service.js';
import { ClockDto } from './dto/clock.dto.js';
import { CreateCorrectionDto } from './dto/create-correction.dto.js';
import { DecideCorrectionDto } from './dto/decide-correction.dto.js';

/**
 * The tenant comes from `@CurrentUser()` and never from the client. Reading someone
 * else's attendance is a service decision rather than a guard one: the permission says
 * *whether* the caller may look past themselves, and `attendance:approve` widens that
 * from their direct reports to the whole organization.
 */
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('clock-in')
  @RequirePermissions('attendance:write')
  clockIn(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClockDto): Promise<TodayStatus> {
    return this.attendance.clockIn(callerOf(user), dto);
  }

  @Post('clock-out')
  @RequirePermissions('attendance:write')
  clockOut(@CurrentUser() user: AuthenticatedUser): Promise<TodayStatus> {
    return this.attendance.clockOut(callerOf(user));
  }

  @Post('breaks/start')
  @RequirePermissions('attendance:write')
  startBreak(@CurrentUser() user: AuthenticatedUser): Promise<TodayStatus> {
    return this.attendance.startBreak(callerOf(user));
  }

  @Post('breaks/stop')
  @RequirePermissions('attendance:write')
  stopBreak(@CurrentUser() user: AuthenticatedUser): Promise<TodayStatus> {
    return this.attendance.stopBreak(callerOf(user));
  }

  @Get('me/today')
  @RequirePermissions('attendance:read')
  today(@CurrentUser() user: AuthenticatedUser): Promise<TodayStatus> {
    return this.attendance.today(callerOf(user));
  }

  @Get('me/week')
  @RequirePermissions('attendance:read')
  week(
    @CurrentUser() user: AuthenticatedUser,
    @Query('offset') offset?: string,
    @Query('userId') userId?: string,
  ): Promise<TimesheetWeek> {
    return this.attendance.week(callerOf(user), toOffset(offset), userId);
  }

  @Get('me/schedule')
  @RequirePermissions('attendance:read')
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
  ): Promise<WorkScheduleSummary> {
    return this.attendance.scheduleOf(callerOf(user), userId);
  }

  @Get()
  @RequirePermissions('attendance:read')
  range(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AttendanceSegment[]> {
    return this.attendance.range(callerOf(user), { userId, from, to });
  }

  @Get('corrections')
  @RequirePermissions('attendance:read')
  corrections(
    @CurrentUser() user: AuthenticatedUser,
    @Query('mine') mine?: string,
  ): Promise<CorrectionSummary[]> {
    return this.attendance.listCorrections(callerOf(user), mine === 'true');
  }

  @Post('corrections')
  @RequirePermissions('attendance:write')
  requestCorrection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCorrectionDto,
  ): Promise<CorrectionSummary> {
    return this.attendance.requestCorrection(callerOf(user), dto);
  }

  @Post('corrections/:id/approve')
  @RequirePermissions('attendance:approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideCorrectionDto,
  ): Promise<CorrectionSummary> {
    return this.attendance.decideCorrection(callerOf(user), id, true, dto.note);
  }

  @Post('corrections/:id/reject')
  @RequirePermissions('attendance:approve')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideCorrectionDto,
  ): Promise<CorrectionSummary> {
    return this.attendance.decideCorrection(callerOf(user), id, false, dto.note);
  }
}

function callerOf(user: AuthenticatedUser): Caller {
  return {
    id: user.id,
    organizationId: user.organizationId,
    canApprove: user.permissions.includes('attendance:approve'),
  };
}

/** `?offset=-1` for last week. Anything unparseable reads as the current week. */
function toOffset(value?: string): number {
  const offset = Number(value);

  return Number.isInteger(offset) ? offset : 0;
}
