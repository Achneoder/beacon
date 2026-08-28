import { Entity, Enum, Property, Unique } from '@mikro-orm/core';
import type { AbsenceColorRole } from '@beacon/shared';
import { ABSENCE_COLOR_ROLES } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * A kind of absence an organization offers, seeded from `DEFAULT_ABSENCE_TYPES` when
 * the tenant is created and editable afterwards.
 *
 * The three flags are independent on purpose: home office is not paid leave, it is a
 * working day that happens to appear on the calendar. Collapsing them into a single
 * "is it leave" would make the timesheet tag and the quota disagree.
 */
@Entity({ tableName: 'absence_types' })
@Unique({ properties: ['organization', 'key'] })
export class AbsenceType extends OrganizationScopedEntity {
  /** Stable across renames — the seed, the timesheet tag and the tests all use it. */
  @Property({ type: 'string', length: 64 })
  key!: string;

  @Property({ type: 'string', length: 120 })
  name!: string;

  /** Vacation alone, out of the eight seeded types. */
  @Property({ type: 'boolean', default: false })
  deductsFromQuota: boolean = false;

  @Property({ type: 'boolean', default: true })
  paid: boolean = true;

  /** True for home office, training and business trips: real hours, still tagged. */
  @Property({ type: 'boolean', default: false })
  countsAsWork: boolean = false;

  /**
   * A palette role, not a hex value — the design tokens carry both themes, and a
   * stored colour would go unreadable the first time someone switches to dark.
   */
  @Enum({ items: () => ABSENCE_COLOR_ROLES, type: 'string', default: 'accent' })
  colorRole: AbsenceColorRole = 'accent';

  /** Retired rather than deleted: old requests must keep naming their type. */
  @Property({ type: 'boolean', default: true })
  active: boolean = true;

  @Property({ type: 'integer', default: 0 })
  position: number = 0;
}
