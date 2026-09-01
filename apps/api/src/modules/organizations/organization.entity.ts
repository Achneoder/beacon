import { Entity, Property, Unique } from '@mikro-orm/core';
import type { LocaleCode } from '@beacon/shared';
import { BaseEntity } from '../../common/entities/base.entity.js';

/**
 * Tenant root: employees, attendance, holidays and documents all hang off an organization.
 *
 * Property types are always declared explicitly — the CLI runs through tsx/esbuild, which
 * does not emit decorator metadata, so reflection-based inference is unavailable.
 *
 * `selfApproveCorrections` is named optional so `em.create` does not demand it —
 * registration has no opinion on the setting, and the column's `false` default is
 * the answer until an administrator says otherwise.
 */
@Entity({ tableName: 'organizations' })
export class Organization extends BaseEntity<'selfApproveCorrections'> {
  @Property({ type: 'string', length: 200 })
  name!: string;

  @Unique()
  @Property({ type: 'string', length: 100 })
  slug!: string;

  /** The language every user who has not chosen one of their own is shown. */
  @Property({ type: 'string', length: 10, default: 'en' })
  defaultLocale: LocaleCode = 'en';

  @Property({ type: 'string', length: 64, default: 'UTC' })
  timezone: string = 'UTC';

  /**
   * Whether an employee's own timesheet correction is applied on the spot instead of
   * routing to their manager.
   *
   * Default false, and deliberately so: approval is the arrangement the correction
   * flow was built around, and an installation that upgrades into this column must
   * not silently lose it. Trust-based organizations turn it on in Settings.
   */
  @Property({ type: 'boolean', default: false })
  selfApproveCorrections: boolean = false;
}
