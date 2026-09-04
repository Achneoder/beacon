import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLES,
  OWNER_ROLE_KEY,
  PERMISSIONS,
  PERMISSION_AREAS,
  SELF_SERVICE_PERMISSIONS,
  isOwnerRole,
  isSelfServicePermission,
  permissionArea,
} from './permissions.js';

describe('PERMISSIONS', () => {
  it('every permission is `area:verb`, which the role editor groups by', () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it('names every area once, in the order the union first mentions it', () => {
    expect(PERMISSION_AREAS).toEqual([
      'organization',
      'employee',
      'attendance',
      'holiday',
      'document',
      'project',
      'time',
      'report',
    ]);
    // Nothing is left out: the editor renders area by area, so a permission in no
    // area would be one nobody could ever check.
    expect(PERMISSIONS.every((permission) => PERMISSION_AREAS.includes(permissionArea(permission))))
      .toBe(true);
  });

  it('gives owner the whole union — the invariant the role editor refuses to break', () => {
    expect([...DEFAULT_ROLES[OWNER_ROLE_KEY]]).toEqual([...PERMISSIONS]);
  });

  it('exempts only self-scoped permissions from the grant rule', () => {
    for (const permission of SELF_SERVICE_PERMISSIONS) {
      expect(isSelfServicePermission(permission)).toBe(true);
    }
    expect(isSelfServicePermission('organization:manage')).toBe(false);
    // The one an administrator holds and must not be able to hand out by accident.
    expect(isSelfServicePermission('document:manage')).toBe(false);
    // Booking time is self-scoped like clocking in; administering the catalog is not.
    expect(isSelfServicePermission('time:write')).toBe(true);
    expect(isSelfServicePermission('project:manage')).toBe(false);
  });
});

describe('isOwnerRole', () => {
  it('is the built-in owner, and nothing that merely calls itself that', () => {
    expect(isOwnerRole({ key: 'owner', isSystem: true })).toBe(true);
    // A role an organization named "owner" is theirs to edit — the protection belongs
    // to the seeded one, which is the one guaranteed to hold organization:manage.
    expect(isOwnerRole({ key: 'owner', isSystem: false })).toBe(false);
    expect(isOwnerRole({ key: 'admin', isSystem: true })).toBe(false);
  });
});
