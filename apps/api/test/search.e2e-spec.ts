import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import type { SearchResult } from '@beacon/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';
import { resetBucket } from './storage.js';
import { resetSearchIndex, until } from './search.js';

/**
 * Search against a real Meilisearch, for the same reason the mail specs go through a
 * real Mailpit: a mocked `SearchService` would prove the call was made, not that a
 * document one person owns stays invisible to another. That claim is the whole point
 * of the phase, and this is the only layer it is visible at.
 */

const RUN = Date.now().toString(36);
const ORG_NAME = `Findable ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@search.test`;
const PASSWORD = 'correct-horse-battery';

const PDF_HEADER = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('Search (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let ownerToken: string;
  let annaToken: string;
  let annaId: string;
  let benToken: string;
  let categoryId: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  async function invite(email: string, firstName: string): Promise<{ token: string; id: string }> {
    const invitation = await http()
      .post('/api/invitations')
      .set(as(ownerToken))
      .send({ email, firstName, lastName: 'Tester' })
      .expect(201);

    const accepted = await http()
      .post('/api/invitations/accept')
      .send({ token: invitation.body.token, password: PASSWORD })
      .expect(201);

    const people = await http().get('/api/users').set(as(ownerToken)).expect(200);
    const id = people.body.find((person: { email: string }) => person.email === email).id;

    return { token: accepted.body.accessToken, id };
  }

  async function upload(token: string, title: string): Promise<string> {
    const response = await http()
      .post('/api/documents')
      .set(as(token))
      .field('title', title)
      .field('categoryId', categoryId)
      .attach('file', PDF_HEADER, { filename: 'payslip.pdf', contentType: 'application/pdf' })
      .expect(201);

    return response.body.id;
  }

  async function find(token: string, term: string): Promise<SearchResult[]> {
    const response = await http()
      .get(`/api/search?q=${encodeURIComponent(term)}`)
      .set(as(token))
      .expect(200);

    return response.body.results;
  }

  /**
   * Indexing is fire-and-forget — `SearchSubscriber` never blocks a write on the
   * search backend — so a spec that uploads and then searches is racing a write it
   * deliberately did not wait for. Polling is the honest way to assert on that; a
   * fixed sleep would be either flaky or slow.
   */
  function findEventually(token: string, term: string, expected: (results: SearchResult[]) => boolean) {
    return until(() => find(token, term), expected);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    orm = app.get(MikroORM);
    await resetInstance(orm);
    await resetBucket();
    await resetSearchIndex();

    const registration = await http()
      .post('/api/auth/register')
      .send({
        organizationName: ORG_NAME,
        email: OWNER_EMAIL,
        password: PASSWORD,
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      .expect(201);
    ownerToken = registration.body.accessToken;

    const anna = await invite(`anna.${RUN}@search.test`, 'Annabel');
    annaToken = anna.token;
    annaId = anna.id;
    benToken = (await invite(`ben.${RUN}@search.test`, 'Bernard')).token;

    const categories = await http().get('/api/document-categories').set(as(annaToken)).expect(200);
    categoryId = categories.body.find((c: { key: string }) => c.key === 'payslips').id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('availability', () => {
    it('reports a configured backend', async () => {
      const response = await http().get('/api/search?q=anything').set(as(annaToken)).expect(200);

      expect(response.body.available).toBe(true);
    });

    it('refuses an anonymous caller', async () => {
      await http().get('/api/search?q=payslip').expect(401);
    });
  });

  describe('visibility', () => {
    let annasDocumentId: string;

    beforeAll(async () => {
      annasDocumentId = await upload(annaToken, `Zymurgy${RUN} payslip`);
    });

    it('finds the document its owner uploaded', async () => {
      const results = await findEventually(
        annaToken,
        `Zymurgy${RUN}`,
        (found) => found.length > 0,
      );

      expect(results).toContainEqual(
        expect.objectContaining({
          type: 'document',
          id: annasDocumentId,
          title: `Zymurgy${RUN} payslip`,
          subtitle: 'Payslips',
          href: `/documents?open=${annasDocumentId}`,
        }),
      );
    });

    it("never returns someone else's personal document", async () => {
      // The index matched it — the term is unique to that title — and the database
      // is what takes it away again. This is the phase's central claim.
      const results = await find(benToken, `Zymurgy${RUN}`);

      expect(results.filter((result) => result.type === 'document')).toEqual([]);
    });

    it('returns it to the same person once a grant is made', async () => {
      const ben = await http().get('/api/users').set(as(ownerToken)).expect(200);
      const benId = ben.body.find((person: { firstName: string }) => person.firstName === 'Bernard')
        .id;

      await http()
        .post(`/api/documents/${annasDocumentId}/access`)
        .set(as(ownerToken))
        .send({ subject: 'user', subjectId: benId, level: 'read' })
        .expect(201);

      // No re-index happened — the grant changed no indexed field. It takes effect
      // because visibility is read from the database on every query, which is exactly
      // why grants are not in the index.
      const results = await find(benToken, `Zymurgy${RUN}`);

      expect(results.map((result) => result.id)).toContain(annasDocumentId);
    });

    it('drops a soft-deleted document out of the index', async () => {
      const doomed = await upload(annaToken, `Ephemeral${RUN} payslip`);
      await findEventually(annaToken, `Ephemeral${RUN}`, (found) => found.length > 0);

      await http().delete(`/api/documents/${doomed}`).set(as(ownerToken)).expect(204);

      const results = await findEventually(
        annaToken,
        `Ephemeral${RUN}`,
        (found) => found.length === 0,
      );
      expect(results).toEqual([]);
    });
  });

  describe('people', () => {
    it('finds a colleague for a caller who may read employees', async () => {
      const results = await findEventually(
        ownerToken,
        'Annabel',
        (found) => found.some((result) => result.type === 'employee'),
      );

      expect(results).toContainEqual(
        expect.objectContaining({ type: 'employee', id: annaId, href: `/people/${annaId}` }),
      );
    });

    it('returns no people to a plain employee, who holds no employee:read', async () => {
      const results = await find(annaToken, 'Annabel');

      expect(results.filter((result) => result.type === 'employee')).toEqual([]);
    });

    it('narrows to the requested type', async () => {
      const response = await http()
        .get('/api/search?q=Annabel&types=document')
        .set(as(ownerToken))
        .expect(200);

      expect(
        (response.body.results as SearchResult[]).filter((result) => result.type === 'employee'),
      ).toEqual([]);
    });
  });

  describe('term handling', () => {
    it('returns nothing for a term below the minimum length', async () => {
      const response = await http().get('/api/search?q=a').set(as(annaToken)).expect(200);

      expect(response.body.results).toEqual([]);
    });

    it('returns nothing for an empty term', async () => {
      const response = await http().get('/api/search').set(as(annaToken)).expect(200);

      expect(response.body.results).toEqual([]);
    });
  });

  describe('reindex', () => {
    it('refuses a caller without organization:manage', async () => {
      await http().post('/api/search/reindex').set(as(annaToken)).expect(403);
    });

    it('rebuilds the organization from the database', async () => {
      // The repair for a fresh container: wipe the index behind the API's back, then
      // prove the button puts it back.
      await resetSearchIndex();
      expect(await find(annaToken, `Zymurgy${RUN}`)).toEqual([]);

      const response = await http()
        .post('/api/search/reindex')
        .set(as(ownerToken))
        .expect(200);

      expect(response.body.documents).toBeGreaterThan(0);
      expect(response.body.employees).toBeGreaterThan(0);

      const results = await findEventually(
        annaToken,
        `Zymurgy${RUN}`,
        (found) => found.length > 0,
      );
      expect(results.map((result) => result.type)).toContain('document');
    });

    it('leaves a soft-deleted document out of the rebuild', async () => {
      const results = await find(annaToken, `Ephemeral${RUN}`);

      expect(results).toEqual([]);
    });
  });
});
