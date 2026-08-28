import { Index, ManyToOne, type Ref } from '@mikro-orm/core';
import { BaseEntity } from './base.entity.js';
import { Organization } from '../../modules/organizations/organization.entity.js';

/**
 * Base class for every tenant-owned record. Extending this makes the organization
 * column mandatory — repositories must still scope their queries by it.
 */
export abstract class OrganizationScopedEntity extends BaseEntity {
  @Index()
  @ManyToOne(() => Organization, { ref: true })
  organization!: Ref<Organization>;
}
