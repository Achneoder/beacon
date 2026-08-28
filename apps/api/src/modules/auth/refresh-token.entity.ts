import { Entity, Index, ManyToOne, Property, Unique, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';

/**
 * One issued refresh token. Only the SHA-256 hash is stored — a database leak must not
 * hand out usable sessions. Refreshing rotates: the presented row is revoked and points
 * at its successor, so replaying a spent token is detectable.
 */
@Entity({ tableName: 'refresh_tokens' })
export class RefreshToken extends OrganizationScopedEntity {
  @Index()
  @ManyToOne({ entity: () => User, ref: true })
  user!: Ref<User>;

  @Unique()
  @Property({ type: 'string', length: 64 })
  tokenHash!: string;

  @Property({ type: 'timestamptz' })
  expiresAt!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;

  /** Set when this token was rotated, so a replay can be traced to its successor. */
  @Property({ type: 'string', length: 64, nullable: true })
  replacedByHash: string | null = null;

  @Property({ type: 'string', length: 255, nullable: true })
  userAgent: string | null = null;
}
