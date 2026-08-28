import { Entity, Property, Unique } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';

/**
 * A folder documents are filed under, seeded from `DEFAULT_DOCUMENT_CATEGORIES` when
 * the tenant is first read and editable afterwards.
 *
 * A direct mirror of `AbsenceType`: no icon column, because the table's row icon is
 * derived from the file's content type, not the category it sits in.
 */
@Entity({ tableName: 'document_categories' })
@Unique({ properties: ['organization', 'key'] })
export class DocumentCategory extends OrganizationScopedEntity {
  /** Stable across renames — the seed and the tests both name a category by this. */
  @Property({ type: 'string', length: 64 })
  key!: string;

  @Property({ type: 'string', length: 120 })
  name!: string;

  @Property({ type: 'integer', default: 0 })
  position: number = 0;

  /** Retired rather than deleted: old documents must keep naming theirs. */
  @Property({ type: 'boolean', default: true })
  active: boolean = true;
}
