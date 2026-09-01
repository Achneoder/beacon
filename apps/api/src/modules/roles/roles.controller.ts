import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser, RoleSummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { RolesService } from './roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

/**
 * Roles are organization settings, so the three mutations sit behind
 * `organization:manage` — the same permission the SSO settings and the organization
 * itself need. Reading is `organization:read`, because every screen that assigns a role
 * or shares a document by role has to be able to name them.
 *
 * The permission check is only the door. What a caller may actually put in a role is
 * decided by their own permission union, in `RolesService` — `organization:manage` is
 * not a licence to mint authority its holder does not have.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('organization:read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<RoleSummary[]> {
    return this.roles.list(user.organizationId);
  }

  @Post()
  @RequirePermissions('organization:manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRoleDto): Promise<RoleSummary> {
    return this.roles.create(user.organizationId, dto, user.permissions);
  }

  @Patch(':id')
  @RequirePermissions('organization:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleSummary> {
    return this.roles.update(user.organizationId, id, dto, user.permissions);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('organization:manage')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.roles.remove(user.organizationId, id, user.permissions);
  }
}
