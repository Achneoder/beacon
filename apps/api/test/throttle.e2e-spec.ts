import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

/**
 * The password endpoints are the brute-force target, so `PASSWORD_THROTTLE` tightens
 * the baseline for them.
 *
 * This spec is the regression test for the tracker naming: the override used to be
 * stored under an `auth` tracker the module never registered, so `@Throttle` was
 * silently inert and every auth route ran at the 120/min baseline. Ten attempts a
 * minute is what the default `AUTH_THROTTLE_LIMIT` promises; the eleventh must 429.
 */
describe('Password throttle (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    await resetInstance(app.get(MikroORM));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses the eleventh password attempt within a minute', async () => {
    // Installing the instance is itself a password endpoint and spends one of its own
    // ten — the counter is per route, so the logins below start from zero.
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: 'Throttle Org',
        email: 'owner@throttle.test',
        password: 'correct-horse-battery',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      .expect(201);

    for (let attempt = 1; attempt <= 10; attempt++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'owner@throttle.test', password: 'wrong-password' })
        .expect(401);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'owner@throttle.test', password: 'wrong-password' });

    expect(blocked.status).toBe(429);
  });
});
