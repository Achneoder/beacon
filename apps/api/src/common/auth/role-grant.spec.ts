import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from '@beacon/shared';
import { assertGrantable } from './role-grant.js';

const role = (key: keyof typeof DEFAULT_ROLES) => ({
  name: key,
  permissions: DEFAULT_ROLES[key] as readonly Permission[],
});

describe('assertGrantable', () => {
  it('refuses an admin the owner role — the escalation this exists to stop', () => {
    // `admin` holds employee:manage (so it reaches the role endpoints) but not
    // organization:manage. Without this check it could read the owner role's id off
    // GET /organizations/current/roles and assign it to itself.
    expect(() => assertGrantable(DEFAULT_ROLES.admin, [role('owner')])).toThrow(ForbiddenException);
    expect(() => assertGrantable(DEFAULT_ROLES.admin, [role('owner')])).toThrow(
      /organization:manage/,
    );
  });

  it('still lets an admin grant the default employee role', () => {
    // The case a plain subset rule would break: `admin` deliberately holds neither
    // attendance:write nor holiday:request, and inviting an employee is the single
    // most common thing an administrator does.
    expect(() => assertGrantable(DEFAULT_ROLES.admin, [role('employee')])).not.toThrow();
  });

  it('lets an admin grant manager and admin', () => {
    expect(() => assertGrantable(DEFAULT_ROLES.admin, [role('manager'), role('admin')])).not.toThrow();
  });

  it('lets an owner grant anything', () => {
    const every = Object.keys(DEFAULT_ROLES).map((key) => role(key as keyof typeof DEFAULT_ROLES));

    expect(() => assertGrantable(PERMISSIONS, every)).not.toThrow();
  });

  it('refuses a custom role carrying a permission the granter lacks', () => {
    const auditor = { name: 'auditor', permissions: ['report:read', 'document:manage'] as const };

    expect(() => assertGrantable(DEFAULT_ROLES.manager, [auditor])).toThrow(/document:manage/);
  });

  it('checks every role in the batch, not just the first', () => {
    expect(() => assertGrantable(DEFAULT_ROLES.admin, [role('employee'), role('owner')])).toThrow(
      ForbiddenException,
    );
  });

  it('names the permission rather than the role — roles are customizable', () => {
    expect(() => assertGrantable([], [{ name: 'anything', permissions: ['employee:manage'] }])).toThrow(
      /employee:manage/,
    );
  });

  it('allows an empty grant', () => {
    expect(() => assertGrantable([], [])).not.toThrow();
  });
});
