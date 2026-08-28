import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy, type JwtPayload } from './jwt.strategy.js';

const config = { getOrThrow: () => 'test-secret' } as unknown as ConfigService;

describe('JwtStrategy', () => {
  const strategy = new JwtStrategy(config);

  it('maps token claims onto the authenticated user', () => {
    const payload: JwtPayload = {
      sub: 'u1',
      org: 'o1',
      email: 'owner@acme.test',
      permissions: ['attendance:read'],
    };

    expect(strategy.validate(payload)).toEqual({
      id: 'u1',
      organizationId: 'o1',
      email: 'owner@acme.test',
      permissions: ['attendance:read'],
    });
  });

  it('defaults to no permissions when the claim is absent', () => {
    const payload = { sub: 'u1', org: 'o1', email: 'a@b.test' } as JwtPayload;

    expect(strategy.validate(payload).permissions).toEqual([]);
  });
});
