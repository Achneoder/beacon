import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

/**
 * Shared by bootstrap() and the e2e suites, so tests exercise the same prefix, CORS,
 * cookie parsing and validation rules the real server runs with.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService);

  assertProductionConfig(config);
  trustProxy(app, config);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  return app;
}

/**
 * CORS fails closed.
 *
 * The refresh token travels in a cookie the browser sends to whatever origin it is
 * told to, so "every origin allowed with credentials" would let an attacker page on
 * any origin trade that cookie for a fresh access token — the whole session. Unset,
 * no browser origin is allowed at all, and a production server refuses to boot rather
 * than start as the open-by-default server this used to be.
 */
function corsOrigins(): string[] | false {
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CORS_ORIGIN must list at least one origin in production');
    }
    return false;
  }

  return origins;
}

/**
 * How many reverse-proxy hops in front of this process are ours to believe.
 *
 * `ThrottlerGuard` keys its buckets on `req.ip`, and Beacon is deployed on-premise
 * behind a proxy, so with Express's default (`trust proxy` off) every request in the
 * organization arrives as the proxy's own address and shares one bucket: the 10/min
 * password limit becomes a company-wide budget, and one person mistyping their password
 * locks everybody — including `/auth/refresh`, so live sessions start dropping too.
 *
 * The naive remedy is worse than the disease. `trust proxy: true` makes
 * `X-Forwarded-For` client-controlled, which hands an attacker an unlimited supply of
 * buckets and removes the limit outright. So this is a *count* of hops, from
 * configuration, defaulting to 0 — no proxy trusted until an operator says how many
 * there are. A comma-separated list of addresses or CIDRs is accepted too, for a
 * deployment that would rather name its proxies than count them.
 */
function trustProxy(app: INestApplication, config: ConfigService): void {
  const raw = (config.get<string>('TRUST_PROXY') ?? '').trim();
  if (raw === '') return;

  const hops = Number(raw);
  const setting = Number.isInteger(hops) && hops >= 0 ? hops : raw;

  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set(
    'trust proxy',
    setting,
  );
}

/**
 * Boot-time refusal for configuration that is only ever a mistake in production.
 *
 * The same reasoning as `corsOrigins()` above, applied to the secrets: `.env.example`
 * is a file people copy, and every value in it is public. `getOrThrow` catches an
 * *absent* `JWT_SECRET`, but a *published* one is worse — it signs access tokens, and
 * `JwtStrategy.validate` trusts their claims wholesale, so anyone who has read this
 * repository can mint a token for any user with any permission set. Failing to start is
 * the only honest response; discovering it later is indistinguishable from never
 * discovering it.
 *
 * Only ever runs under NODE_ENV=production, so development and both e2e suites (which
 * run as `test` with fixed throwaway values) are untouched.
 */
function assertProductionConfig(config: ConfigService): void {
  if (config.get<string>('NODE_ENV') !== 'production') return;

  const problems: string[] = [];

  const jwtSecret = config.get<string>('JWT_SECRET') ?? '';
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  } else if (isPlaceholder(jwtSecret)) {
    problems.push('JWT_SECRET is still an example value — generate one: openssl rand -base64 32');
  }

  // The refresh cookie is the credential that outlives everything else — 30 days of
  // session, in the clear on any network hop if it is not marked Secure.
  if (config.get<string>('AUTH_COOKIE_SECURE') !== 'true') {
    problems.push('AUTH_COOKIE_SECURE must be "true"');
  }
  // A browser refuses SameSite=None without Secure outright, so this would be a session
  // that silently never persists rather than an insecure one — still a boot-time bug.
  if (
    (config.get<string>('AUTH_COOKIE_SAME_SITE') ?? '').toLowerCase() === 'none' &&
    config.get<string>('AUTH_COOKIE_SECURE') !== 'true'
  ) {
    problems.push('AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true');
  }

  for (const key of ['STORAGE_SECRET_KEY', 'STORAGE_ACCESS_KEY', 'SEARCH_API_KEY']) {
    const value = config.get<string>(key);
    if (value && isPlaceholder(value)) problems.push(`${key} is still an example value`);
  }

  if (problems.length > 0) {
    throw new Error(`refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Long enough that an HS256 key is not worth attacking offline. */
const MIN_SECRET_LENGTH = 32;

/**
 * The values `.env.example` ships. Matched exactly rather than by substring — an
 * operator whose real secret happens to contain "beacon" must not be refused a boot.
 */
const PLACEHOLDERS = new Set([
  'change-me-in-production',
  'changeme',
  'secret',
  'beacon',
  'beacon-secret',
  'beacon-search-key',
]);

function isPlaceholder(value: string): boolean {
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));

  await app.listen(process.env.PORT ?? 3000);
}

// Vitest imports this module for configureApp; only the real entry point listens.
if (process.env.VITEST === undefined) {
  await bootstrap();
}
