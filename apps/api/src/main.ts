import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

/**
 * Shared by bootstrap() and the e2e suites, so tests exercise the same prefix, CORS,
 * cookie parsing and validation rules the real server runs with.
 */
export function configureApp(app: INestApplication): INestApplication {
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

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));

  await app.listen(process.env.PORT ?? 3000);
}

// Vitest imports this module for configureApp; only the real entry point listens.
if (process.env.VITEST === undefined) {
  await bootstrap();
}
