import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser, ProjectDetail, ProjectSummary, TaskSummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

/**
 * `GET` sits behind `time:read`, not `project:manage` — the catalog has to be visible
 * to anyone booking time against it, the same deviation `document-categories` makes
 * for `document:read`. Every write needs `project:manage`, the permission dedicated to
 * administering the catalog.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('time:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ProjectSummary[]> {
    return this.projects.list(user.organizationId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('time:read')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ProjectDetail> {
    return this.projects.get(user.organizationId, id, includeInactive === 'true');
  }

  @Post()
  @RequirePermissions('project:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectSummary> {
    return this.projects.create(user.organizationId, dto);
  }

  @Patch(':id')
  @RequirePermissions('project:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectSummary> {
    return this.projects.update(user.organizationId, id, dto);
  }

  /** Retiring rather than deleting — a past `TimeEntry` must keep naming it. */
  @Delete(':id')
  @RequirePermissions('project:manage')
  retire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectSummary> {
    return this.projects.retire(user.organizationId, id);
  }

  @Post(':id/tasks')
  @RequirePermissions('project:manage')
  createTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskSummary> {
    return this.projects.createTask(user.organizationId, id, dto);
  }

  @Patch(':id/tasks/:taskId')
  @RequirePermissions('project:manage')
  updateTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskSummary> {
    return this.projects.updateTask(user.organizationId, id, taskId, dto);
  }

  /** Retiring rather than deleting — a past `TimeEntry` must keep naming it. */
  @Delete(':id/tasks/:taskId')
  @RequirePermissions('project:manage')
  retireTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<TaskSummary> {
    return this.projects.retireTask(user.organizationId, id, taskId);
  }
}
