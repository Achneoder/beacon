import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

function contextFor(isPublic: boolean): ExecutionContext {
  const handler = () => undefined;
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);

  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(new Reflector());

  it('lets a @Public() handler through without a token', () => {
    expect(guard.canActivate(contextFor(true))).toBe(true);
  });

  it('delegates to passport when the handler is not public', () => {
    // Stub the AuthGuard('jwt') base so the assertion is about delegation, not about
    // passport's own verdict on a tokenless request.
    const base = Object.getPrototypeOf(JwtAuthGuard.prototype);
    const superCanActivate = vi.spyOn(base, 'canActivate').mockReturnValue(false);
    const context = contextFor(false);

    expect(guard.canActivate(context)).toBe(false);
    expect(superCanActivate).toHaveBeenCalledWith(context);

    superCanActivate.mockRestore();
  });
});
