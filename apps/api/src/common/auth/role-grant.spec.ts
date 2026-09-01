import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from '@beacon/shared';
import { assertGrantable, assertRoleEditable } from './role-grant.js';

const role = (key: keyof typeof DEFAULT_ROLES) => ({
  name: key,
  permissions: DEFAULT_ROLES[key] as readonly Permission[],
});

describe('assertGrantable', () => {
  it('refuses an admin the owner role — the escalation this exists to stop', () => {
    // `admin` holds employee:manage (so it reaches the role endpoints) but not
    // organization:manage. Without this check it could read the owner role's id off
    // GET /roles and assign it to itself.
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

describe('assertRoleEditable', () => {
  it('refuses an admin the owner role — the same escalation, reached by editing', () => {
    // The role editor's half of the rule. `admin` cannot rewrite `owner`, so it cannot
    // add itself a permission by widening a role it is then assigned.
    expect(() => assertRoleEditable(DEFAULT_ROLES.admin, role('owner'))).toThrow(ForbiddenException);
    expect(() => assertRoleEditable(DEFAULT_ROLES.admin, role('owner'))).toThrow(
      /organization:manage/,
    );
  });

  it('refuses stripping authority the editor never had', () => {
    // The case `assertGrantable` alone misses: the new permission list would pass —
    // it holds nothing the manager lacks — but the role being rewritten holds
    // document:manage, and disarming a colleague is not a manager's to do.
    const auditor = { name: 'auditor', permissions: ['report:read', 'document:manage'] as const };

    expect(() => assertRoleEditable(DEFAULT_ROLES.manager, auditor)).toThrow(/document:manage/);
  });

  it('lets an admin maintain the employee role', () => {
    // Self-service again: `admin` holds none of what `employee` carries and still owns
    // the role, exactly as it owns handing it out.
    expect(() => assertRoleEditable(DEFAULT_ROLES.admin, role('employee'))).not.toThrow();
  });

  it('lets an owner edit anything', () => {
    for (const key of Object.keys(DEFAULT_ROLES) as (keyof typeof DEFAULT_ROLES)[]) {
      expect(() => assertRoleEditable(PERMISSIONS, role(key))).not.toThrow();
    }
  });

  it('says "edit", not "grant" — the caller is not handing anything out', () => {
    expect(() => assertRoleEditable([], { name: 'auditor', permissions: ['report:read'] })).toThrow(
      /you may not edit "auditor"/,
    );
  });
});
