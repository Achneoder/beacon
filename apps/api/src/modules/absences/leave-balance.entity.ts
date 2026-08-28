import { DecimalType, Entity, ManyToOne, Property, Unique, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';

/**
 * A person's quota for one year.
 *
 * `takenDays` counts every *committed* day — approved and taken alike — because an
 * approved week in December is spent the moment it is granted, not the moment it
 * arrives. Pending days are counted from the requests themselves, so a withdrawal
 * needs no compensating write here.
 */
@Entity({ tableName: 'leave_balances' })
@Unique({ properties: ['user', 'year'] })
export class LeaveBalance extends OrganizationScopedEntity<'entitlementDays' | 'carryOverDays' | 'takenDays'> {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @Property({ type: 'integer' })
  year!: number;

  /** Per employee — the design's slider runs 20–40. */
  @Property({ type: new DecimalType('number'), precision: 5, scale: 2, default: 0 })
  entitlementDays: number = 0;

  @Property({ type: new DecimalType('number'), precision: 5, scale: 2, default: 0 })
  carryOverDays: number = 0;

  /** Use-it-or-lose-it. Null means the carry-over never expires. */
  @Property({ type: 'date', nullable: true })
  carryOverExpiresOn: string | null = null;

  @Property({ type: new DecimalType('number'), precision: 5, scale: 2, default: 0 })
  takenDays: number = 0;
}
