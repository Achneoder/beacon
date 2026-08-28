import { DecimalType, Entity, Enum, Index, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import type { AbsenceStatus } from '@beacon/shared';
import { ABSENCE_STATUSES } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { AbsenceType } from './absence-type.entity.js';

/**
 * One request for time away, from the day it is raised to the day it is lived.
 *
 * Dates, not instants: an absence has no time of day, and storing it as a timestamp
 * would make "the 28th" depend on who is reading it. The half-day flags are the only
 * sub-day resolution the design asks for.
 */
@Entity({ tableName: 'absence_requests' })
@Index({ properties: ['organization', 'user', 'startsOn'] })
@Index({ properties: ['organization', 'status'] })
export class AbsenceRequest extends OrganizationScopedEntity {
  @ManyToOne(() => User, { ref: true })
  user!: Ref<User>;

  @ManyToOne(() => AbsenceType, { ref: true })
  type!: Ref<AbsenceType>;

  @Property({ type: 'date' })
  startsOn!: string;

  /** Inclusive. A one-day request has `startsOn === endsOn`. */
  @Property({ type: 'date' })
  endsOn!: string;

  @Property({ type: 'boolean', default: false })
  halfDayStart: boolean = false;

  @Property({ type: 'boolean', default: false })
  halfDayEnd: boolean = false;

  /**
   * Four-valued: `taken` is what an approved absence becomes once it has been lived.
   * The distinction is what stops a withdrawal of days already spent.
   */
  @Enum({ items: () => ABSENCE_STATUSES, type: 'string', default: 'pending' })
  status: AbsenceStatus = 'pending';

  /**
   * What the request cost the quota, frozen when it was raised.
   *
   * Recomputing it on every read would let a public holiday added in November
   * silently rewrite an August holiday that has already been taken and paid.
   */
  @Property({ type: new DecimalType('number'), precision: 5, scale: 2, default: 0 })
  costDays: number = 0;

  /** The manager it routes to — `User.manager`, the same edge corrections use. */
  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  approver: Ref<User> | null = null;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  decidedBy: Ref<User> | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null = null;

  @Property({ type: 'string', length: 1000, nullable: true })
  decisionNote: string | null = null;

  /** "Optional — visible to your manager." */
  @Property({ type: 'string', length: 1000, nullable: true })
  note: string | null = null;

  /**
   * The sick note. Phase 4 owns `Document`, so this stays a bare id until then —
   * the column exists now so the link does not need a migration later.
   */
  @Property({ type: 'uuid', nullable: true })
  documentId: string | null = null;
}
