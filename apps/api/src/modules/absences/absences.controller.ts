import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  AbsenceCalendar,
  AbsenceRequestSummary,
  AbsenceStatus,
  AbsenceTypeSummary,
  AuthenticatedUser,
  HolidaySummary,
  LeaveBalanceSummary,
} from '@beacon/shared';
import { ABSENCE_STATUSES } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { AbsencesService, type Caller, type CalendarFilter } from './absences.service.js';
import { CreateAbsenceDto } from './dto/create-absence.dto.js';
import { DecideAbsenceDto } from './dto/decide-absence.dto.js';

/**
 * The tenant comes from `@CurrentUser()` and never from the client. `holiday:approve`
 * is what widens a caller past their own record — the permission says *whether* they
 * may look, and the service decides *whose*.
 *
 * Reading is gated by `attendance:read`, not by `holiday:request`. The two are not the
 * same population: the default `manager` and `admin` roles approve time off and never
 * ask for it, so gating the queue behind the requester's permission locked the
 * approvers out of the screen built for them. Requesting still needs
 * `holiday:request`, and deciding still needs `holiday:approve`.
 */
@Controller('absences')
export class AbsencesController {
  constructor(private readonly absences: AbsencesService) {}

  @Get()
  @RequirePermissions('attendance:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
  ): Promise<AbsenceRequestSummary[]> {
    return this.absences.list(callerOf(user), {
      userId,
      status: toStatus(status),
      mine: mine === 'true',
    });
  }

  @Post()
  @RequirePermissions('holiday:request')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAbsenceDto,
  ): Promise<AbsenceRequestSummary> {
    return this.absences.create(callerOf(user), dto);
  }

  /** Withdrawing your own request, and only while it is still pending. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('holiday:request')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.absences.withdraw(callerOf(user), id);
  }

  @Post(':id/approve')
  @RequirePermissions('holiday:approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAbsenceDto,
  ): Promise<AbsenceRequestSummary> {
    return this.absences.decide(callerOf(user), id, true, dto.note);
  }

  @Post(':id/reject')
  @RequirePermissions('holiday:approve')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAbsenceDto,
  ): Promise<AbsenceRequestSummary> {
    return this.absences.decide(callerOf(user), id, false, dto.note);
  }

  @Get('calendar')
  @RequirePermissions('attendance:read')
  calendar(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('scope') scope?: string,
  ): Promise<AbsenceCalendar> {
    return this.absences.calendar(callerOf(user), { from, to, userId, scope: toScope(scope) });
  }

  @Get('types')
  @RequirePermissions('attendance:read')
  types(@CurrentUser() user: AuthenticatedUser): Promise<AbsenceTypeSummary[]> {
    return this.absences.listTypes(user.organizationId);
  }

  @Get('holidays')
  @RequirePermissions('attendance:read')
  holidays(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<HolidaySummary[]> {
    return this.absences.listHolidays(user.organizationId, from, to);
  }

  @Get('balances/me')
  @RequirePermissions('attendance:read')
  myBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
  ): Promise<LeaveBalanceSummary> {
    return this.absences.balanceOf(callerOf(user), undefined, toYear(year));
  }

  @Get('balances')
  @RequirePermissions('employee:read')
  balance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('year') year?: string,
  ): Promise<LeaveBalanceSummary> {
    return this.absences.balanceOf(callerOf(user), userId, toYear(year));
  }
}

export function callerOf(user: AuthenticatedUser): Caller {
  return {
    id: user.id,
    organizationId: user.organizationId,
    canApprove: user.permissions.includes('holiday:approve'),
  };
}

function toStatus(value?: string): AbsenceStatus | undefined {
  return ABSENCE_STATUSES.find((status) => status === value);
}

function toScope(value?: string): CalendarFilter['scope'] {
  return value === 'me' || value === 'team' || value === 'organization' ? value : undefined;
}

/** An unparseable year reads as "the current one", which the service resolves. */
function toYear(value?: string): number | undefined {
  const year = Number(value);

  return Number.isInteger(year) && year > 2000 ? year : undefined;
}
