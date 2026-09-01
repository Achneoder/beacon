import { Entity, Property, Unique } from '@mikro-orm/core';
import type { LocaleCode } from '@beacon/shared';
import { BaseEntity } from '../../common/entities/base.entity.js';

/**
 * Tenant root: employees, attendance, holidays and documents all hang off an organization.
 *
 * Property types are always declared explicitly — the CLI runs through tsx/esbuild, which
 * does not emit decorator metadata, so reflection-based inference is unavailable.
 */
@Entity({ tableName: 'organizations' })
export class Organization extends BaseEntity {
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
}
