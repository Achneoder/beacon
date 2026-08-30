import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { BEACON_PRODUCT, INSTANCE_API_VERSION } from '@beacon/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';

const RUN = Date.now().toString(36);
const ORG_NAME = `Instance Co ${RUN}`;
const EMAIL = `owner.${RUN}@instance.test`;
const PASSWORD = 'correct-horse-battery';

describe('Instance (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    orm = app.get(MikroORM);
    await resetInstance(orm);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('identifies the instance without a token, and says nothing about the tenant', async () => {
    const response = await request(app.getHttpServer()).get('/api/instance').expect(200);

    expect(response.body).toEqual({
      product: BEACON_PRODUCT,
      apiVersion: INSTANCE_API_VERSION,
      setupRequired: true,
    });
    // The whole point: an unauthenticated caller must never learn who runs this
    // installation — only that it is Beacon, and whether it has been installed yet.
    expect(Object.keys(response.body).sort()).toEqual(['apiVersion', 'product', 'setupRequired']);
  });

  it('flips setupRequired once the instance is installed', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: ORG_NAME,
        email: EMAIL,
        password: PASSWORD,
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      .expect(201);

    const response = await request(app.getHttpServer()).get('/api/instance').expect(200);

    expect(response.body).toEqual({
      product: BEACON_PRODUCT,
      apiVersion: INSTANCE_API_VERSION,
      setupRequired: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(ORG_NAME);
  });
});
