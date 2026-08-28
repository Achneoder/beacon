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
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  return app;
}

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));

  await app.listen(process.env.PORT ?? 3000);
}

// Vitest imports this module for configureApp; only the real entry point listens.
if (process.env.VITEST === undefined) {
  await bootstrap();
}
