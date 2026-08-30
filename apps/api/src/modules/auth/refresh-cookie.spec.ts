import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { durationToSeconds, setRefreshCookie } from './refresh-cookie.js';

describe('durationToSeconds', () => {
  it.each([
    ['15m', 900],
    ['30d', 2_592_000],
    ['2h', 7200],
    ['45s', 45],
    ['3600', 3600],
  ])('parses %s', (input, expected) => {
    expect(durationToSeconds(input, 1)).toBe(expected);
  });

  it('falls back when the value is not a duration', () => {
    expect(durationToSeconds('forever', 42)).toBe(42);
  });
});

const configFor = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/** The options `setRefreshCookie` actually hands Express. */
function optionsFor(values: Record<string, string>): CookieOptions {
  let captured: CookieOptions = {};
  const response = {
    cookie: (_name: string, _token: string, options: CookieOptions) => {
      captured = options;
    },
  } as unknown as Response;

  setRefreshCookie(response, configFor(values), 'token', 1000);

  return captured;
}

describe('the refresh cookie', () => {
  it('is always HttpOnly and scoped to the auth routes', () => {
    const options = optionsFor({});

    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe('/api/auth');
  });

  it('is Secure in production even when nothing says so', () => {
    // The 30-day credential the whole session hangs from. Shipping it in the clear is
    // not a deployment choice worth honouring.
    expect(optionsFor({ NODE_ENV: 'production' }).secure).toBe(true);
  });

  it('cannot be turned off in production by configuration', () => {
    expect(optionsFor({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }).secure).toBe(true);
  });

  it('is not Secure in development, so localhost still works over http', () => {
    expect(optionsFor({}).secure).toBe(false);
  });

  it('can still be turned on outside production', () => {
    expect(optionsFor({ AUTH_COOKIE_SECURE: 'true' }).secure).toBe(true);
  });

  it('falls back to Lax for an unrecognised SameSite', () => {
    expect(optionsFor({ AUTH_COOKIE_SAME_SITE: 'sideways' }).sameSite).toBe('lax');
    expect(optionsFor({ AUTH_COOKIE_SAME_SITE: 'none' }).sameSite).toBe('none');
  });
});
