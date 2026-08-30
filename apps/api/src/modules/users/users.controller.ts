import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser, UserDetail, UserSummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { UsersService } from './users.service.js';
import type { UserStatus } from './user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { SetRolesDto } from './dto/set-roles.dto.js';

/**
 * The tenant always comes from `@CurrentUser()`; no route reads an organization id from
 * the client. Copied from `organization.controller.ts` — that is the shape to follow.
 *
 * `/users/me` is only authenticated, not permissioned: everyone may read and adjust
 * their own profile, and the service restricts *which* fields that means.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserDetail> {
    return this.users.findDetail(user.organizationId, user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() changes: UpdateProfileDto,
  ): Promise<UserDetail> {
    return this.users.updateOwnProfile(user.organizationId, user.id, changes);
  }

  @Get()
  @RequirePermissions('employee:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('departmentId') departmentId?: string,
    @Query('teamId') teamId?: string,
    @Query('status') status?: UserStatus,
    @Query('search') search?: string,
  ): Promise<UserSummary[]> {
    return this.users.list(user.organizationId, { departmentId, teamId, status, search });
  }

  @Post()
  @RequirePermissions('employee:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ): Promise<UserDetail> {
    return this.users.create(user.organizationId, dto, user.permissions);
  }

  @Get(':id')
  @RequirePermissions('employee:read')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDetail> {
    return this.users.findDetail(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('employee:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() changes: UpdateUserDto,
  ): Promise<UserDetail> {
    return this.users.update(user.organizationId, id, changes);
  }

  @Post(':id/roles')
  @RequirePermissions('employee:manage')
  setRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolesDto,
  ): Promise<UserDetail> {
    return this.users.setRoles(user.organizationId, id, dto.roleIds, user.permissions);
  }

  /**
   * Soft delete: the account is disabled, never removed. Attendance, absence and
   * document history all point at the user, and history must not lose its author.
   */
  @Delete(':id')
  @RequirePermissions('employee:manage')
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDetail> {
    return this.users.disable(user.organizationId, id, user.id);
  }
}
