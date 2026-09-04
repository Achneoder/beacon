import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  ProjectDetail,
  ProjectSummary,
  TaskSummary,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from '@beacon/shared';
import { Organization } from '../organizations/organization.entity.js';
import { Project } from './project.entity.js';
import { Task } from './task.entity.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly em: EntityManager) {}

  async list(organizationId: string, includeInactive = false): Promise<ProjectSummary[]> {
    const projects = await this.em.find(
      Project,
      { organization: organizationId },
      { orderBy: { name: 'asc' } },
    );
    const visible = projects.filter((project) => includeInactive || project.active);
    const counts = await this.taskCounts(organizationId, visible.map((project) => project.id));

    return visible.map((project) => toProjectSummary(project, counts.get(project.id) ?? 0));
  }

  async get(organizationId: string, id: string, includeInactive = false): Promise<ProjectDetail> {
    const project = await this.findEntity(organizationId, id);
    const tasks = await this.em.find(
      Task,
      { organization: organizationId, project: id },
      { orderBy: { name: 'asc' } },
    );
    const visible = tasks.filter((task) => includeInactive || task.active);

    return {
      ...toProjectSummary(project, visible.length),
      tasks: visible.map(toTaskSummary),
    };
  }

  async create(organizationId: string, dto: CreateProjectRequest): Promise<ProjectSummary> {
    if (await this.em.count(Project, { organization: organizationId, name: dto.name })) {
      throw new BadRequestException('a project with that name already exists');
    }

    const project = this.em.create(Project, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      name: dto.name,
      clientName: dto.clientName ?? null,
      description: dto.description ?? null,
      hourlyRate: dto.hourlyRate ?? null,
      active: true,
    });
    await this.em.flush();

    return toProjectSummary(project, 0);
  }

  async update(organizationId: string, id: string, dto: UpdateProjectRequest): Promise<ProjectSummary> {
    const project = await this.findEntity(organizationId, id);

    if (dto.name !== undefined && dto.name !== project.name) {
      if (await this.em.count(Project, { organization: organizationId, name: dto.name })) {
        throw new BadRequestException('a project with that name already exists');
      }
      project.name = dto.name;
    }
    if (dto.clientName !== undefined) project.clientName = dto.clientName;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.hourlyRate !== undefined) project.hourlyRate = dto.hourlyRate;

    await this.em.flush();

    const counts = await this.taskCounts(organizationId, [project.id]);

    return toProjectSummary(project, counts.get(project.id) ?? 0);
  }

  /** Retired rather than deleted — a past `TimeEntry` must keep naming it. */
  async retire(organizationId: string, id: string): Promise<ProjectSummary> {
    const project = await this.findEntity(organizationId, id);
    project.active = false;
    await this.em.flush();

    const counts = await this.taskCounts(organizationId, [project.id]);

    return toProjectSummary(project, counts.get(project.id) ?? 0);
  }

  async createTask(organizationId: string, projectId: string, dto: CreateTaskRequest): Promise<TaskSummary> {
    const project = await this.findEntity(organizationId, projectId);

    if (await this.em.count(Task, { organization: organizationId, project: projectId, name: dto.name })) {
      throw new BadRequestException('a task with that name already exists on this project');
    }

    const task = this.em.create(Task, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      project: ref(project),
      name: dto.name,
      hourlyRate: dto.hourlyRate ?? null,
      active: true,
    });
    await this.em.flush();

    return toTaskSummary(task);
  }

  async updateTask(
    organizationId: string,
    projectId: string,
    taskId: string,
    dto: UpdateTaskRequest,
  ): Promise<TaskSummary> {
    const task = await this.findTaskEntity(organizationId, projectId, taskId);

    if (dto.name !== undefined && dto.name !== task.name) {
      if (await this.em.count(Task, { organization: organizationId, project: projectId, name: dto.name })) {
        throw new BadRequestException('a task with that name already exists on this project');
      }
      task.name = dto.name;
    }
    if (dto.hourlyRate !== undefined) task.hourlyRate = dto.hourlyRate;

    await this.em.flush();

    return toTaskSummary(task);
  }

  /** Retired rather than deleted — a past `TimeEntry` must keep naming it. */
  async retireTask(organizationId: string, projectId: string, taskId: string): Promise<TaskSummary> {
    const task = await this.findTaskEntity(organizationId, projectId, taskId);
    task.active = false;
    await this.em.flush();

    return toTaskSummary(task);
  }

  // ---------------------------------------------------------------- for time-entries

  /** 404 on missing/wrong-org, 400 on retired — the one place that check is made. */
  async findBookableProjectOrThrow(organizationId: string, projectId: string): Promise<Project> {
    const project = await this.findEntity(organizationId, projectId);
    if (!project.active) throw new BadRequestException('that project is retired');

    return project;
  }

  /** 404 on missing/wrong-org/wrong-project, 400 on retired. */
  async findBookableTaskOrThrow(organizationId: string, projectId: string, taskId: string): Promise<Task> {
    const task = await this.findTaskEntity(organizationId, projectId, taskId);
    if (!task.active) throw new BadRequestException('that task is retired');

    return task;
  }

  // ---------------------------------------------------------------- internals

  private async findEntity(organizationId: string, id: string): Promise<Project> {
    const project = await this.em.findOne(Project, { id, organization: organizationId });
    if (!project) throw new NotFoundException('project not found');

    return project;
  }

  private async findTaskEntity(organizationId: string, projectId: string, taskId: string): Promise<Task> {
    const task = await this.em.findOne(Task, {
      id: taskId,
      organization: organizationId,
      project: projectId,
    });
    if (!task) throw new NotFoundException('task not found');

    return task;
  }

  private async taskCounts(organizationId: string, projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();

    const tasks = await this.em.find(
      Task,
      { organization: organizationId, project: { $in: projectIds }, active: true },
      { fields: ['project'] },
    );

    const counts = new Map<string, number>();
    for (const task of tasks) {
      const projectId = task.project.id;
      counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
    }

    return counts;
  }
}

export function toProjectSummary(project: Project, taskCount: number): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    clientName: project.clientName,
    description: project.description,
    hourlyRate: project.hourlyRate,
    active: project.active,
    taskCount,
  };
}

export function toTaskSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    projectId: task.project.id,
    name: task.name,
    hourlyRate: task.hourlyRate,
    active: task.active,
  };
}
