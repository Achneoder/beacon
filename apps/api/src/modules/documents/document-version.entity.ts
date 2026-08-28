import { Entity, Index, ManyToOne, Property, Unique, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { Document } from './document.entity.js';

/**
 * One uploaded file. A document keeps every version it has ever had; only
 * `Document.currentVersion` says which one is current.
 *
 * Extends `OrganizationScopedEntity` even though a version is reachable via its
 * document — every tenant-owned row carries the column, which keeps a version query
 * tenant-safe without a join.
 */
@Entity({ tableName: 'document_versions' })
@Index({ properties: ['organization', 'document'] })
@Unique({ properties: ['document', 'versionNumber'] })
export class DocumentVersion extends OrganizationScopedEntity {
  @ManyToOne(() => Document, { ref: true, deleteRule: 'cascade' })
  document!: Ref<Document>;

  /** 1-based. Allocated under a pessimistic lock on the parent, never `count() + 1`. */
  @Property({ type: 'integer' })
  versionNumber!: number;

  /** `org/<orgId>/documents/<docId>/<versionId>` — ids only, never the filename. */
  @Property({ type: 'string', length: 512 })
  storageKey!: string;

  @Property({ type: 'integer' })
  size!: number;

  /** The sniffed type, never the client's declared one. */
  @Property({ type: 'string', length: 120 })
  contentType!: string;

  @Property({ type: 'string', length: 64 })
  checksum!: string;

  /** Display only — sanitized to a bare basename, and never part of the storage key. */
  @Property({ type: 'string', length: 255 })
  originalFilename!: string;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  uploadedBy: Ref<User> | null = null;
}
