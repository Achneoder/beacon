import { Entity, ManyToOne, Property, type Ref } from '@mikro-orm/core';
import { OrganizationScopedEntity } from '../../common/entities/organization-scoped.entity.js';
import { AttendanceEntry } from './attendance-entry.entity.js';

/**
 * A break is a first-class clock state, not a derived gap: the design's control has
 * three states, and only a stored break can be resumed after a page reload. Breaks
 * always fall inside their entry, and their minutes are subtracted from worked time
 * rather than added to it.
 */
@Entity({ tableName: 'break_entries' })
export class BreakEntry extends OrganizationScopedEntity {
  @ManyToOne(() => AttendanceEntry, { ref: true, deleteRule: 'cascade' })
  entry!: Ref<AttendanceEntry>;

  @Property({ type: 'timestamptz' })
  startedAt!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  endedAt: Date | null = null;
}
