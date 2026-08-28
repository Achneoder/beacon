import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type {
  AbsenceTypeSummary,
  AuthenticatedUser,
  HolidaySummary,
  LeaveBalanceSummary,
} from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { AbsencesService } from './absences.service.js';
import { callerOf } from './absences.controller.js';
import { CreateAbsenceTypeDto } from './dto/create-absence-type.dto.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';
import { UpsertLeaveBalanceDto } from './dto/upsert-leave-balance.dto.js';

/**
 * The administrative half: which absence types exist, which days the office is shut,
 * and how much leave each person gets.
 *
 * Types and holidays reuse `organization:manage` rather than inventing an
 * `absence:manage` permission — they are organization settings, and the permission
 * union only grows when a phase says so. A quota is an employment term, so it sits
 * behind `employee:manage` instead.
 */
@Controller()
export class AbsenceSettingsController {
  constructor(private readonly absences: AbsencesService) {}

  @Get('absence-types')
  @RequirePermissions('organization:manage')
  listTypes(@CurrentUser() user: AuthenticatedUser): Promise<AbsenceTypeSummary[]> {
    // Retired types are shown here and nowhere else: settings is where they come back.
    return this.absences.listTypes(user.organizationId, true);
  }

  @Post('absence-types')
  @RequirePermissions('organization:manage')
  createType(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAbsenceTypeDto,
  ): Promise<AbsenceTypeSummary> {
    return this.absences.createType(user.organizationId, dto);
  }

  @Delete('absence-types/:id')
  @RequirePermissions('organization:manage')
  retireType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AbsenceTypeSummary> {
    return this.absences.retireType(user.organizationId, id);
  }

  @Get('public-holidays')
  @RequirePermissions('attendance:read')
  listHolidays(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<HolidaySummary[]> {
    return this.absences.listHolidays(user.organizationId, from, to);
  }

  @Post('public-holidays')
  @RequirePermissions('organization:manage')
  createHoliday(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHolidayDto,
  ): Promise<HolidaySummary> {
    return this.absences.createHoliday(user.organizationId, dto);
  }

  @Delete('public-holidays/:id')
  @HttpCode(204)
  @RequirePermissions('organization:manage')
  deleteHoliday(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.absences.deleteHoliday(user.organizationId, id);
  }

  @Post('users/:id/leave-balance')
  @RequirePermissions('employee:manage')
  upsertBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertLeaveBalanceDto,
  ): Promise<LeaveBalanceSummary> {
    return this.absences.upsertBalance(callerOf(user), id, dto);
  }
}
