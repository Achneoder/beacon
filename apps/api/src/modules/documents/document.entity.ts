import { Collection, Entity, Index, ManyToOne, OneToMany, Property, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { DocumentCategory } from './document-category.entity.js';
import { DocumentVersion } from './document-version.entity.js';
import { DocumentAccess } from './document-access.entity.js';

/**
 * One filed document — a title, a category, and a pointer to whichever version is
 * current. The bytes live in `StorageService`; this row (and its versions) is the
 * only thing that says where.
 *
 * A null `owner` *is* "organization-wide" rather than a second `visibility` column —
 * two representations of the same fact would eventually disagree. That makes the
 * `restrict` delete rule below load-bearing: users are only ever soft-disabled today,
 * but a future hard delete must fail loudly rather than silently publish someone's
 * payslips to the whole company.
 */
@Entity({ tableName: 'documents' })
@Index({ properties: ['organization', 'owner'] })
@Index({ properties: ['organization', 'category'] })
@Index({ properties: ['deletedAt'] })
export class Document extends OrganizationScopedEntity {
  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'restrict' })
  owner: Ref<User> | null = null;

  @Property({ type: 'string', length: 255 })
  title!: string;

  /** Retiring a category does not touch documents already filed under it. */
  @ManyToOne(() => DocumentCategory, { ref: true, deleteRule: 'restrict' })
  category!: Ref<DocumentCategory>;

  /**
   * Nullable only because the row is created before its first version — the circular
   * foreign key means one of the two must come first. Both land in the same
   * transaction, so this is never observably null once a caller can see the row.
   */
  @ManyToOne(() => DocumentVersion, { ref: true, nullable: true, deleteRule: 'set null' })
  currentVersion: Ref<DocumentVersion> | null = null;

  @Property({ type: 'date', nullable: true })
  retentionUntil: string | null = null;

  /**
   * Soft delete: the bytes stay, and every read filters `deletedAt: null` —
   * `document:manage` included. A `retentionUntil` in the future refuses the delete
   * outright instead.
   */
  @Property({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null = null;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  deletedBy: Ref<User> | null = null;

  @OneToMany(() => DocumentVersion, (version) => version.document)
  versions = new Collection<DocumentVersion>(this);

  @OneToMany(() => DocumentAccess, (access) => access.document)
  access = new Collection<DocumentAccess>(this);
}
