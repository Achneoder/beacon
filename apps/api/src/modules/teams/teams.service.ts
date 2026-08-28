import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import type { TeamSummary } from '@beacon/shared';
import { Department } from '../departments/department.entity.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { Team } from './team.entity.js';
import type { TeamDto } from './dto/team.dto.js';

@Injectable()
export class TeamsService {
  constructor(private readonly em: EntityManager) {}

  async list(organizationId: string, departmentId?: string): Promise<TeamSummary[]> {
    const teams = await this.em.find(
      Team,
      { organization: organizationId, ...(departmentId ? { department: departmentId } : {}) },
      { orderBy: { name: 'asc' } },
    );

    const counts = await this.memberCounts(organizationId);

    return teams.map((team) => this.toSummary(team, counts.get(team.id) ?? 0));
  }

  async create(organizationId: string, dto: TeamDto): Promise<TeamSummary> {
    await this.assertNameIsFree(organizationId, dto.name);

    const team = this.em.create(Team, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      name: dto.name,
      department: await this.departmentRef(organizationId, dto.departmentId ?? null),
    });
    await this.em.flush();

    return this.toSummary(team, 0);
  }

  async update(organizationId: string, id: string, dto: TeamDto): Promise<TeamSummary> {
    const team = await this.findEntity(organizationId, id);

    if (team.name !== dto.name) {
      await this.assertNameIsFree(organizationId, dto.name);
      team.name = dto.name;
    }
    if (dto.departmentId !== undefined) {
      team.department = await this.departmentRef(organizationId, dto.departmentId);
    }
    await this.em.flush();

    const counts = await this.memberCounts(organizationId);

    return this.toSummary(team, counts.get(team.id) ?? 0);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.em.removeAndFlush(await this.findEntity(organizationId, id));
  }

  private toSummary(team: Team, memberCount: number): TeamSummary {
    return {
      id: team.id,
      name: team.name,
      departmentId: team.department?.id ?? null,
      memberCount,
    };
  }

  private async findEntity(organizationId: string, id: string): Promise<Team> {
    const team = await this.em.findOne(Team, { id, organization: organizationId });
    if (!team) throw new NotFoundException('team not found');

    return team;
  }

  private async assertNameIsFree(organizationId: string, name: string): Promise<void> {
    if (await this.em.count(Team, { organization: organizationId, name })) {
      throw new ConflictException('a team with that name already exists');
    }
  }

  /** Scoped, so a team can never be filed under another tenant's department. */
  private async departmentRef(organizationId: string, departmentId: string | null) {
    if (!departmentId) return null;

    const department = await this.em.findOne(Department, {
      id: departmentId,
      organization: organizationId,
    });
    if (!department) throw new BadRequestException('department does not exist');

    return ref(department);
  }

  private async memberCounts(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.em
      .createQueryBuilder(User, 'u')
      .select(['u.team_id as team_id', 'count(*) as count'])
      .where({ organization: organizationId, team: { $ne: null } })
      .groupBy('u.team_id')
      .execute<{ team_id: string; count: string }[]>();

    return new Map(rows.map((row) => [row.team_id, Number(row.count)]));
  }
}
