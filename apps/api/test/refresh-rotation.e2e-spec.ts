import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

/**
 * The one spec that presents the same refresh token twice *at the same time* — the
 * race rotation has to survive. Two tabs of one browser share the cookie jar, so a
 * concurrent refresh is not evidence of theft: the loser is refused without the
 * family dying. The stolen-token side — replay revokes the whole family — lives in
 * auth.e2e-spec.ts, which sets the grace window to zero.
 */
const RUN = Date.now().toString(36);
const ORG_NAME = `Rotation ${RUN}`;
const EMAIL = `owner.${RUN}@rotation.test`;
const PASSWORD = 'correct-horse-battery';

function refreshCookie(response: request.Response): string {
  const cookies = response.get('Set-Cookie') ?? [];
  const cookie = cookies.find((value) => value.startsWith('beacon_refresh='));
  if (!cookie) throw new Error('no refresh cookie was set');

  return cookie.split(';')[0];
}

describe('Refresh rotation (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    // Registration installs the instance and then refuses forever, so every file has to
    // start from an empty database. Files run one at a time — see vitest.config.e2e.ts.
    await resetInstance(app.get(MikroORM));

    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: ORG_NAME,
        email: EMAIL,
        password: PASSWORD,
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      .expect(201);

    cookie = refreshCookie(registration);
  });

  afterAll(async () => {
    // Nothing to tear down: the next file resets the database before it installs.
    await app?.close();
  });

  it('mints exactly one successor when two tabs present the same token at once', async () => {
    const [left, right] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie),
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie),
    ]);

    // Rotation is exclusive: exactly one request walks away with a successor.
    expect([left.status, right.status].sort()).toEqual([200, 401]);

    // The loser is the same browser's second tab, not a thief — the family survives
    // and the winner's successor keeps working.
    const winner = left.status === 200 ? left : right;
    const next = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie(winner))
      .expect(200);

    expect(next.body.accessToken).toEqual(expect.any(String));
  });

  it('refuses a token that never existed', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', 'beacon_refresh=forged-token')
      .expect(401);
  });
});
