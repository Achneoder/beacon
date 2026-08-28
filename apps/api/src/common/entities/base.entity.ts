import { OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

export abstract class BaseEntity<Optional extends string = never> {
  /**
   * The timestamps are managed by the ORM, so em.create() must not demand them. A
   * subclass with its own derived properties names them via the type parameter, e.g.
   * `class User extends OrganizationScopedEntity<'permissions'>`.
   */
  [OptionalProps]?: 'createdAt' | 'updatedAt' | Optional;

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
