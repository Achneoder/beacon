import type { CookieOptions, Response } from 'express';
import type { ConfigService } from '@nestjs/config';

/** Only the auth endpoints ever need the refresh cookie, so it is scoped to them. */
const COOKIE_PATH = '/api/auth';

const SAME_SITE = new Set(['lax', 'strict', 'none']);

export function cookieName(config: ConfigService): string {
  return config.get<string>('AUTH_COOKIE_NAME') ?? 'beacon_refresh';
}

/**
 * Dev runs web on :5173 and the API on :3000 — cross-origin but same-site, so a Lax
 * cookie is sent. A deployment that splits the two across registrable domains must set
 * AUTH_COOKIE_SAME_SITE=none and AUTH_COOKIE_SECURE=true.
 *
 * `secure` is on by default in production and can only be turned *on* by configuration,
 * never off: this is the 30-day credential the whole session hangs from, and shipping it
 * in the clear is not a deployment choice worth honouring. `assertProductionConfig`
 * (`main.ts`) refuses the boot outright when AUTH_COOKIE_SECURE is not "true", so an
 * operator who meant it insecurely is told rather than quietly overridden — this is the
 * second lock, for any path that reaches the cookie without going through that check.
 */
function baseOptions(config: ConfigService): CookieOptions {
  const sameSite = (config.get<string>('AUTH_COOKIE_SAME_SITE') ?? 'lax').toLowerCase();
  const production = config.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    path: COOKIE_PATH,
    sameSite: (SAME_SITE.has(sameSite) ? sameSite : 'lax') as CookieOptions['sameSite'],
    secure: production || config.get<string>('AUTH_COOKIE_SECURE') === 'true',
    domain: config.get<string>('AUTH_COOKIE_DOMAIN') || undefined,
  };
}

export function setRefreshCookie(
  response: Response,
  config: ConfigService,
  token: string,
  maxAgeMs: number,
): void {
  response.cookie(cookieName(config), token, { ...baseOptions(config), maxAge: maxAgeMs });
}

export function clearRefreshCookie(response: Response, config: ConfigService): void {
  response.clearCookie(cookieName(config), baseOptions(config));
}

/**
 * Parses durations in the same shape as JWT_EXPIRES_IN ("15m", "30d", "3600") into
 * seconds, so one env vocabulary covers both tokens.
 */
export function durationToSeconds(value: string, fallbackSeconds: number): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return fallbackSeconds;

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;

  return amount * multipliers[unit as keyof typeof multipliers];
}
