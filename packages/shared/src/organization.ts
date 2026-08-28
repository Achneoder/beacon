import type { Permission } from './permissions.js';

/**
 * Every tenant-owned record carries its organization. Queries must be scoped by it —
 * there is no global view of employees, attendance or documents.
 */
export interface OrganizationScoped {
  organizationId: string;
}

export interface AuthenticatedUser extends OrganizationScoped {
  id: string;
  email: string;
  permissions: Permission[];
}
