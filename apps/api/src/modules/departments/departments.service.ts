import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { DepartmentSummary } from '@beacon/shared';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { Department } from './department.entity.js';
import type { DepartmentDto } from './dto/department.dto.js';

@Injectable()
export class DepartmentsService {
  constructor(private readonly em: EntityManager) {}

  /**
   * The member count is one grouped query rather than one per department, so the
   * people list's filter row costs two round trips however many departments exist.
   */
  async list(organizationId: string): Promise<DepartmentSummary[]> {
    const departments = await this.em.find(
      Department,
      { organization: organizationId },
      { orderBy: { name: 'asc' } },
    );

    const counts = await this.memberCounts(organizationId);

    return departments.map((department) => ({
      id: department.id,
      name: department.name,
      memberCount: counts.get(department.id) ?? 0,
    }));
  }

  async create(organizationId: string, dto: DepartmentDto): Promise<DepartmentSummary> {
    await this.assertNameIsFree(organizationId, dto.name);

    const department = this.em.create(Department, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      name: dto.name,
    });
    await this.em.flush();

    return { id: department.id, name: department.name, memberCount: 0 };
  }

  async update(
    organizationId: string,
    id: string,
    dto: DepartmentDto,
  ): Promise<DepartmentSummary> {
    const department = await this.findEntity(organizationId, id);

    if (department.name !== dto.name) {
      await this.assertNameIsFree(organizationId, dto.name);
      department.name = dto.name;
    }
    await this.em.flush();

    const counts = await this.memberCounts(organizationId);

    return { id: department.id, name: department.name, memberCount: counts.get(id) ?? 0 };
  }

  /**
   * Departments carry no history of their own, so this is a real delete — the members
   * and teams pointing at it simply lose the reference (`on delete set null`).
   */
  async remove(organizationId: string, id: string): Promise<void> {
    const department = await this.findEntity(organizationId, id);
    await this.em.removeAndFlush(department);
  }

  private async findEntity(organizationId: string, id: string): Promise<Department> {
    const department = await this.em.findOne(Department, { id, organization: organizationId });
    if (!department) throw new NotFoundException('department not found');

    return department;
  }

  private async assertNameIsFree(organizationId: string, name: string): Promise<void> {
    if (await this.em.count(Department, { organization: organizationId, name })) {
      throw new ConflictException('a department with that name already exists');
    }
  }

  private async memberCounts(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.em
      .createQueryBuilder(User, 'u')
      .select(['u.department_id as department_id', 'count(*) as count'])
      .where({ organization: organizationId, department: { $ne: null } })
      .groupBy('u.department_id')
      .execute<{ department_id: string; count: string }[]>();

    return new Map(rows.map((row) => [row.department_id, Number(row.count)]));
  }
}
