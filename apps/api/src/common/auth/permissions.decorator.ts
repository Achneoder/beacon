import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@beacon/shared';

export const PERMISSIONS_KEY = 'beacon:permissions';

/**
 * Roles are customizable per organization, so handlers declare the permissions they
 * need — never a role name.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
