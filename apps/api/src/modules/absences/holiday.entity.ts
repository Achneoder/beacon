import { Entity, Index, Property, Unique } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * A public holiday: a day nobody is expected to work and nobody spends quota on.
 *
 * Per organization rather than global — a company with offices in two countries keeps
 * two sets — and `region` narrows a day to a state or canton where the country does
 * not observe it uniformly. `null` means the whole organization.
 */
@Entity({ tableName: 'holidays' })
@Index({ properties: ['organization', 'date'] })
@Unique({ properties: ['organization', 'date', 'name'] })
export class Holiday extends OrganizationScopedEntity {
  @Property({ type: 'date' })
  date!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  region: string | null = null;
}
