import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';

function contextWith(user: unknown, required?: string[]): ExecutionContext {
  const handler = () => undefined;
  if (required) Reflect.defineMetadata(PERMISSIONS_KEY, required, handler);

  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows handlers that declare no permissions', () => {
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('rejects an unauthenticated request to a guarded handler', () => {
    expect(guard.canActivate(contextWith(undefined, ['attendance:read']))).toBe(false);
  });

  it('requires every declared permission, not just one', () => {
    const user = { id: 'u1', organizationId: 'o1', permissions: ['attendance:read'] };
    expect(guard.canActivate(contextWith(user, ['attendance:read', 'attendance:approve']))).toBe(
      false,
    );
  });

  it('allows a user holding all declared permissions', () => {
    const user = { id: 'u1', organizationId: 'o1', permissions: ['attendance:read'] };
    expect(guard.canActivate(contextWith(user, ['attendance:read']))).toBe(true);
  });
});
