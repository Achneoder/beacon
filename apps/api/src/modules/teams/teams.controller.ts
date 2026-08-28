import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser, TeamSummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { TeamsService } from './teams.service.js';
import { TeamDto } from './dto/team.dto.js';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermissions('employee:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('departmentId') departmentId?: string,
  ): Promise<TeamSummary[]> {
    return this.teams.list(user.organizationId, departmentId);
  }

  @Post()
  @RequirePermissions('employee:manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: TeamDto): Promise<TeamSummary> {
    return this.teams.create(user.organizationId, dto);
  }

  @Patch(':id')
  @RequirePermissions('employee:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TeamDto,
  ): Promise<TeamSummary> {
    return this.teams.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('employee:manage')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.teams.remove(user.organizationId, id);
  }
}
