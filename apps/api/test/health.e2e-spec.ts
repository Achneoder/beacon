import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health reports database connectivity', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toMatchObject({ database: expect.any(String) });
  });

  /**
   * Asserted through a booted app rather than only against the middleware, because the
   * half a unit test cannot show is that it is actually mounted. Health is the cheapest
   * route to prove it on; the middleware runs before routing, so it covers every other.
   */
  it('carries the security headers on every response', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    // Personal data on shared workstations — nothing this API returns may be cached.
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    // Announced only over TLS, and supertest speaks plain http.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('carries them on a 401 too — an error response is still a response', async () => {
    const response = await request(app.getHttpServer()).get('/api/users/me').expect(401);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
