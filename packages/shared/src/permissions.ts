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

/**
 * Permissions whose every code path acts on the holder's own record, and which are
 * therefore not an escalation to hand out.
 *
 * This exists for `assertGrantable` (`apps/api/src/common/auth/role-grant.ts`), which
 * otherwise refuses to let a caller grant a permission they do not hold themselves. A
 * plain subset rule would be wrong here: `admin` deliberately holds none of these —
 * an administrator manages people, they do not clock in on someone else's behalf — so
 * a strict subset would stop an admin handing out the default `employee` role, which
 * is the single most common thing an administrator does.
 *
 * Each entry is self-scoped in code, not merely by convention:
 * `attendance:write` clocks only `caller.id` (`attendance.controller.ts`);
 * `holiday:request` is refused for another subject by `resolveSubject(…, writing)`
 * (`absences.service.ts`); `document:write` needs `document:manage` before
 * `resolveOwner` will accept an `ownerId` that is not the caller's
 * (`documents.service.ts`). Adding to this list widens what a non-owner may grant, so
 * a permission belongs here only once every path that reads it is self-scoped.
 */
export const SELF_SERVICE_PERMISSIONS = [
  'attendance:write',
  'holiday:request',
  'document:write',
] as const satisfies readonly Permission[];

export function isSelfServicePermission(permission: Permission): boolean {
  return (SELF_SERVICE_PERMISSIONS as readonly Permission[]).includes(permission);
}

/**
 * The founding role, seeded by registration.
 *
 * It is the one role the editor refuses to change or delete, and that refusal is what
 * keeps an installation reachable: `owner` always holds every permission, so there is
 * always somewhere `organization:manage` lives. Without it an administrator could edit
 * the last `organization:manage` out of the system and leave a database edit as the
 * only remaining door — the same lockout `enforced` SSO exempts that permission to
 * avoid.
 *
 * Nothing branches on this key to *authorize* anything; it names the one role whose
 * definition is not the organization's to change.
 */
export const OWNER_ROLE_KEY = 'owner';

/** Structural on purpose — the shape is `RoleSummary`'s and the ORM entity's alike. */
export function isOwnerRole(role: { key: string; isSystem: boolean }): boolean {
  return role.isSystem && role.key === OWNER_ROLE_KEY;
}

/** The half before the colon — `attendance` for `attendance:approve`. */
export function permissionArea(permission: Permission): string {
  return permission.slice(0, permission.indexOf(':'));
}

/** Every area, in the order `PERMISSIONS` first mentions it. The role editor groups by it. */
export const PERMISSION_AREAS: readonly string[] = [
  ...new Set(PERMISSIONS.map((permission) => permissionArea(permission))),
];
