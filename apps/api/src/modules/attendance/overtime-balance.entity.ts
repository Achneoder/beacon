import { Entity, ManyToOne, Property, Unique, type Ref } from '@mikro-orm/core';
import { DEFAULT_OVERTIME_CAP_MINUTES } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';

/**
 * A running per-user balance, in minutes.
 *
 * The cap is a threshold, not a ceiling: the balance keeps accruing past it and the
 * API reports how far over it stands. Clamping would silently discard minutes that
 * were genuinely worked, which is the one outcome a time-tracking system must not
 * produce — the cap exists so a manager notices and acts, not so hours disappear.
 */
@Entity({ tableName: 'overtime_balances' })
@Unique({ properties: ['user'] })
export class OvertimeBalance extends OrganizationScopedEntity<'balanceMinutes' | 'capMinutes'> {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @Property({ type: 'integer', default: 0 })
  balanceMinutes: number = 0;

  @Property({ type: 'integer', default: DEFAULT_OVERTIME_CAP_MINUTES })
  capMinutes: number = DEFAULT_OVERTIME_CAP_MINUTES;
}
