import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser, DepartmentSummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { DepartmentsService } from './departments.service.js';
import { DepartmentDto } from './dto/department.dto.js';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('employee:read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<DepartmentSummary[]> {
    return this.departments.list(user.organizationId);
  }

  @Post()
  @RequirePermissions('employee:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DepartmentDto,
  ): Promise<DepartmentSummary> {
    return this.departments.create(user.organizationId, dto);
  }

  @Patch(':id')
  @RequirePermissions('employee:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepartmentDto,
  ): Promise<DepartmentSummary> {
    return this.departments.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('employee:manage')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.departments.remove(user.organizationId, id);
  }
}
