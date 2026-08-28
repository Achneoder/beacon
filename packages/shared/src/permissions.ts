/**
 * Permissions are the unit of authorization. Roles bundle them and are customizable
 * per organization, so application code must check permissions — never a role name.
 */
export const PERMISSIONS = [
  'organization:read',
  'organization:manage',
  'employee:read',
  'employee:manage',
  'attendance:read',
  'attendance:write',
  'attendance:approve',
  'holiday:request',
  'holiday:approve',
  'document:read',
  'document:write',
  'document:manage',
  'report:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Built-in roles shipped out of the box; organizations may add or override their own. */
export const DEFAULT_ROLES = {
  owner: PERMISSIONS,
  admin: [
    'organization:read',
    'employee:read',
    'employee:manage',
    'attendance:read',
    'attendance:approve',
    'holiday:approve',
    'document:read',
    'document:write',
    'document:manage',
    'report:read',
  ],
  manager: [
    'employee:read',
    'attendance:read',
    'attendance:approve',
    'holiday:approve',
    'report:read',
  ],
  employee: ['attendance:read', 'attendance:write', 'holiday:request', 'document:read', 'document:write'],
} as const satisfies Record<string, readonly Permission[]>;

export type DefaultRole = keyof typeof DEFAULT_ROLES;
