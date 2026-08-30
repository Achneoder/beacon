import type { ConfigService } from '@nestjs/config';

/**
 * `CORS_ORIGIN` is a *list* — `main.ts` splits it on commas and hands every entry to
 * `enableCors`. Two places then used the same variable as a fallback for "where the web
 * app lives" and used it whole: the invitation email's accept link
 * (`InvitationsService`) and the SSO callback's redirect target (`SsoAuthController`).
 * On a deployment with two allowed origins and no `WEB_BASE_URL`, both built
 * `https://a.example,https://b.example/login?…` — a link nobody can follow.
 *
 * One parser, used by all three, so the split cannot drift.
 */
export function parseOriginList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Where the browser-facing web app lives, for a link or a redirect that has to point at
 * it rather than at the API.
 *
 * `WEB_BASE_URL` names it outright. Falling back to the *first* `CORS_ORIGIN` is a
 * convenience for the common single-origin deployment, not a second way to configure
 * two: an installation that serves the SPA from more than one origin has to say which
 * one an emailed link should use, and `WEB_BASE_URL` is how.
 */
export function webBaseUrl(config: ConfigService): string {
  const explicit = config.get<string>('WEB_BASE_URL')?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  return parseOriginList(config.get<string>('CORS_ORIGIN'))[0] ?? 'http://localhost:5173';
}
