import { Entity, Enum, Index, ManyToOne, Unique, type Ref } from '@mikro-orm/core';
import type { DocumentAccessLevel, DocumentAccessSubject } from '@beacon/shared';
import { DOCUMENT_ACCESS_LEVELS, DOCUMENT_ACCESS_SUBJECTS } from '@beacon/shared';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { User } from '../users/user.entity.js';
import { Department } from '../departments/department.entity.js';
import { Role } from '../roles/role.entity.js';
import { Document } from './document.entity.js';

/**
 * A grant that widens who may see (or write to) a document beyond its owner.
 * `subject` is stored explicitly rather than inferred from which FK is set — it keeps
 * the mapper total and the service's switch over it exhaustive at compile time.
 *
 * All three subject FKs cascade: a grant to a department or role that is later
 * removed is meaningless on its own, not "grant to everyone".
 */
@Entity({ tableName: 'document_access' })
@Index({ properties: ['organization', 'user'] })
@Index({ properties: ['organization', 'department'] })
@Index({ properties: ['organization', 'role'] })
@Unique({ properties: ['document', 'user'] })
@Unique({ properties: ['document', 'department'] })
@Unique({ properties: ['document', 'role'] })
export class DocumentAccess extends OrganizationScopedEntity {
  @ManyToOne(() => Document, { ref: true, deleteRule: 'cascade' })
  document!: Ref<Document>;

  @Enum({ items: () => DOCUMENT_ACCESS_SUBJECTS, type: 'string' })
  subject!: DocumentAccessSubject;

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'cascade' })
  user: Ref<User> | null = null;

  @ManyToOne(() => Department, { ref: true, nullable: true, deleteRule: 'cascade' })
  department: Ref<Department> | null = null;

  @ManyToOne(() => Role, { ref: true, nullable: true, deleteRule: 'cascade' })
  role: Ref<Role> | null = null;

  /** Organization-wide documents already read for everyone; a grant only ever widens
   *  a personal document, or lifts a specific subject to write. */
  @Enum({ items: () => DOCUMENT_ACCESS_LEVELS, type: 'string', default: 'read' })
  level: DocumentAccessLevel = 'read';

  @ManyToOne(() => User, { ref: true, nullable: true, deleteRule: 'set null' })
  grantedBy: Ref<User> | null = null;
}
