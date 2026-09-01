import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { resetInstance } from './instance.js';
import { resetBucket, objectExists } from './storage.js';
import type { Permission } from '@beacon/shared';
import { Role } from '../src/modules/roles/role.entity.js';
import { Organization } from '../src/modules/organizations/organization.entity.js';

const RUN = Date.now().toString(36);
const ORG_NAME = `Files ${RUN}`;
const OWNER_EMAIL = `owner.${RUN}@files.test`;
const PASSWORD = 'correct-horse-battery';

const PDF_HEADER = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let organizationId: string;
  let ownerToken: string;
  /** Both plain employees — `document:read` and `document:write`, never `:manage`. */
  let aToken: string;
  let aId: string;
  let bToken: string;
  let bId: string;
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

  /** No role-management API exists yet — a direct row is the only way to seed a role
   *  this suite needs (`document:read` alone, no `document:manage`) that isn't one of
   *  the four built-ins. */
  async function createRole(key: string, permissions: Permission[]): Promise<string> {
    const em = orm.em.fork();
    const role = em.create(Role, {
      organization: em.getReference(Organization, organizationId, { wrapped: true }),
      key,
      name: key,
      permissions,
      isSystem: false,
    });
    await em.flush();

    return role.id;
  }

  function upload(
    token: string,
    fields: Record<string, string>,
    buffer: Buffer = PDF_HEADER,
    filename = 'contract.pdf',
    contentType = 'application/pdf',
  ) {
    let req = http().post('/api/documents').set(as(token));
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);

    return req.attach('file', buffer, { filename, contentType });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    orm = app.get(MikroORM);
    await resetInstance(orm);
    await resetBucket();

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

    const org = await http().get('/api/organizations/current').set(as(ownerToken)).expect(200);
    organizationId = org.body.id;

    const a = await invite(`a.${RUN}@files.test`, 'Anna');
    aToken = a.token;
    aId = a.id;
    const b = await invite(`b.${RUN}@files.test`, 'Ben');
    bToken = b.token;
    bId = b.id;

    const categories = await http().get('/api/document-categories').set(as(aToken)).expect(200);
    categoryId = categories.body.find((c: { key: string }) => c.key === 'payslips').id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('categories', () => {
    it('seeds the six built-in categories on first read, readable by a plain employee', async () => {
      const response = await http().get('/api/document-categories').set(as(bToken)).expect(200);

      expect(response.body).toHaveLength(6);
      expect(response.body.map((c: { key: string }) => c.key)).toContain('sick-notes');
    });
  });

  describe('upload and versions', () => {
    let documentId: string;

    it('uploads a first version, sniffed and checksummed', async () => {
      const response = await upload(aToken, { title: 'My contract', categoryId }, PDF_HEADER).expect(
        201,
      );

      expect(response.body).toMatchObject({
        title: 'My contract',
        scope: 'personal',
        ownerId: aId,
        versionNumber: 1,
        contentType: 'application/pdf',
      });
      documentId = response.body.id;

      expect(await objectExists(`org/${organizationId}/documents/${documentId}/${response.body.versionId}`)).toBe(
        true,
      );
    });

    it('adds a second version and moves currentVersion', async () => {
      const second = Buffer.from('%PDF-1.5\nnewer\n');
      const response = await http()
        .post(`/api/documents/${documentId}/versions`)
        .set(as(aToken))
        .attach('file', second, { filename: 'contract-v2.pdf', contentType: 'application/pdf' })
        .expect(201);

      expect(response.body.versionNumber).toBe(2);

      const versions = await http()
        .get(`/api/documents/${documentId}/versions`)
        .set(as(aToken))
        .expect(200);
      expect(versions.body).toHaveLength(2);
      expect(versions.body.map((v: { versionNumber: number }) => v.versionNumber).sort()).toEqual([1, 2]);

      const detail = await http().get(`/api/documents/${documentId}`).set(as(aToken)).expect(200);
      expect(detail.body.versionNumber).toBe(2);
    });

    it('rejects a file over the 20 MB cap', async () => {
      const big = Buffer.concat([PDF_HEADER, Buffer.alloc(20 * 1024 * 1024 + 1)]);
      await upload(aToken, { title: 'Too big', categoryId }, big).expect(413);
    });

    it('rejects a type it cannot recognise', async () => {
      await upload(
        aToken,
        { title: 'Not a pdf', categoryId },
        Buffer.from('just plain text'),
        'notes.pdf',
        'application/pdf',
      ).expect(415);
    });

    it('stores the sniffed type rather than a spoofed one', async () => {
      const response = await upload(
        aToken,
        { title: 'Mislabeled', categoryId },
        PDF_HEADER,
        'contract.jpg',
        'image/jpeg',
      ).expect(201);

      expect(response.body.contentType).toBe('application/pdf');
    });
  });

  describe('visibility', () => {
    let personalDocId: string;
    let orgWideDocId: string;

    it('is invisible to another employee by default', async () => {
      const created = await upload(aToken, { title: 'Payslip Jan', categoryId }, PDF_HEADER).expect(201);
      personalDocId = created.body.id;

      const list = await http().get('/api/documents').set(as(bToken)).expect(200);
      expect(list.body.find((d: { id: string }) => d.id === personalDocId)).toBeUndefined();

      await http().get(`/api/documents/${personalDocId}`).set(as(bToken)).expect(404);
      await http().get(`/api/documents/${personalDocId}/download`).set(as(bToken)).expect(404);
    });

    it('reports [] rather than 403 when filtering by another employee’s id', async () => {
      const list = await http().get(`/api/documents?userId=${aId}`).set(as(bToken)).expect(200);
      expect(list.body).toEqual([]);
    });

    it('is listed by everyone once filed organization-wide', async () => {
      const created = await upload(ownerToken, {
        title: 'Employee handbook',
        categoryId,
        organizationWide: 'true',
      }).expect(201);
      orgWideDocId = created.body.id;
      expect(created.body.scope).toBe('organization');

      const asA = await http().get('/api/documents').set(as(aToken)).expect(200);
      const asB = await http().get('/api/documents').set(as(bToken)).expect(200);
      expect(asA.body.some((d: { id: string }) => d.id === orgWideDocId)).toBe(true);
      expect(asB.body.some((d: { id: string }) => d.id === orgWideDocId)).toBe(true);
    });

    it('a plain employee cannot file into someone else’s record or organization-wide', async () => {
      await upload(aToken, { title: 'Sneaky', categoryId, ownerId: bId }, PDF_HEADER).expect(403);
      await upload(aToken, { title: 'Sneaky', categoryId, organizationWide: 'true' }, PDF_HEADER).expect(
        403,
      );
    });

    it('a user grant lets one specific person see a personal document', async () => {
      await http().get(`/api/documents/${personalDocId}`).set(as(bToken)).expect(404);

      await http()
        .post(`/api/documents/${personalDocId}/access`)
        .set(as(ownerToken))
        .send({ subject: 'user', subjectId: bId })
        .expect(201);

      await http().get(`/api/documents/${personalDocId}`).set(as(bToken)).expect(200);
      const download = await http()
        .get(`/api/documents/${personalDocId}/download`)
        .set(as(bToken))
        .responseType('blob')
        .expect(200);
      expect(download.body).toEqual(PDF_HEADER);
    });

    it('a read grant does not permit a new version; a write grant does', async () => {
      const twoMore = Buffer.from('%PDF-1.4\nfrom-b\n');
      await http()
        .post(`/api/documents/${personalDocId}/versions`)
        .set(as(bToken))
        .attach('file', twoMore, { filename: 'v.pdf', contentType: 'application/pdf' })
        .expect(403);

      const grants = await http()
        .get(`/api/documents/${personalDocId}`)
        .set(as(ownerToken))
        .expect(200);
      const grantId = grants.body.access[0].id;
      await http()
        .delete(`/api/documents/${personalDocId}/access/${grantId}`)
        .set(as(ownerToken))
        .expect(204);
      await http()
        .post(`/api/documents/${personalDocId}/access`)
        .set(as(ownerToken))
        .send({ subject: 'user', subjectId: bId, level: 'write' })
        .expect(201);

      await http()
        .post(`/api/documents/${personalDocId}/versions`)
        .set(as(bToken))
        .attach('file', twoMore, { filename: 'v.pdf', contentType: 'application/pdf' })
        .expect(201);
    });

    it('a department grant reaches its members and stops reaching a member moved out', async () => {
      const department = await http()
        .post('/api/departments')
        .set(as(ownerToken))
        .send({ name: `Ops ${RUN}` })
        .expect(201);

      await http().patch(`/api/users/${aId}`).set(as(ownerToken)).send({ departmentId: department.body.id }).expect(200);

      const doc = await upload(ownerToken, { title: 'Ops manual', categoryId, organizationWide: 'false' }).expect(
        201,
      );
      // Filed to the owner by default (no ownerId given); grant the department instead.
      await http()
        .post(`/api/documents/${doc.body.id}/access`)
        .set(as(ownerToken))
        .send({ subject: 'department', subjectId: department.body.id })
        .expect(201);

      await http().get(`/api/documents/${doc.body.id}`).set(as(aToken)).expect(200);

      await http().patch(`/api/users/${aId}`).set(as(ownerToken)).send({ departmentId: null }).expect(200);

      await http().get(`/api/documents/${doc.body.id}`).set(as(aToken)).expect(404);
    });

    it('a role grant reaches every holder and stops reaching a member moved to another role', async () => {
      const auditorRoleId = await createRole('auditor', ['document:read']);

      const c = await invite(`c.${RUN}@files.test`, 'Cleo');
      await http().post(`/api/users/${c.id}/roles`).set(as(ownerToken)).send({ roleIds: [auditorRoleId] }).expect(201);

      const doc = await upload(ownerToken, { title: 'Audit trail', categoryId }).expect(201);
      await http()
        .post(`/api/documents/${doc.body.id}/access`)
        .set(as(ownerToken))
        .send({ subject: 'role', subjectId: auditorRoleId })
        .expect(201);

      await http().get(`/api/documents/${doc.body.id}`).set(as(c.token)).expect(200);

      // Roles are read fresh from the database, not from the token — moving Cleo back
      // to the default employee role takes effect on her very next request.
      const roles = await http().get('/api/roles').set(as(ownerToken)).expect(200);
      const employeeRoleId = roles.body.find((r: { key: string }) => r.key === 'employee').id;
      await http().post(`/api/users/${c.id}/roles`).set(as(ownerToken)).send({ roleIds: [employeeRoleId] }).expect(201);

      await http().get(`/api/documents/${doc.body.id}`).set(as(c.token)).expect(404);
    });

    it('document:manage sees everything without any grant', async () => {
      const list = await http().get('/api/documents').set(as(ownerToken)).expect(200);
      expect(list.body.find((d: { id: string }) => d.id === personalDocId)).toBeTruthy();
    });

    it('the download streams back exactly the uploaded bytes', async () => {
      const created = await upload(
        aToken,
        { title: 'Roundtrip', categoryId },
        PDF_HEADER,
        'Gehaltsabrechnung Mai.pdf',
      ).expect(201);

      // Mocking StorageService would prove the call was made, not the MinIO
      // conversation — this is the only layer where the round trip is visible.
      const download = await http()
        .get(`/api/documents/${created.body.id}/download`)
        .set(as(aToken))
        .responseType('blob')
        .expect(200)
        .expect('Content-Type', 'application/pdf')
        .expect('Cache-Control', 'no-store');

      expect(download.body).toEqual(PDF_HEADER);
      expect(download.headers['content-length']).toBe(String(PDF_HEADER.length));
      // The uploader's own filename comes back, in both forms. What a hostile one
      // does to the header is content-disposition.spec.ts's subject, not this one's:
      // multipart re-encodes anything exotic on the way in.
      expect(download.headers['content-disposition']).toBe(
        `attachment; filename="Gehaltsabrechnung Mai.pdf"; filename*=UTF-8''Gehaltsabrechnung%20Mai.pdf`,
      );
    });
  });

  describe('delete and retention', () => {
    it('refuses to delete while retentionUntil is in the future, then soft-deletes once cleared', async () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const created = await upload(aToken, { title: 'Retained', categoryId }, PDF_HEADER).expect(201);

      await http()
        .patch(`/api/documents/${created.body.id}`)
        .set(as(ownerToken))
        .send({ retentionUntil: future.toISOString().slice(0, 10) })
        .expect(200);

      await http().delete(`/api/documents/${created.body.id}`).set(as(ownerToken)).expect(400);

      await http()
        .patch(`/api/documents/${created.body.id}`)
        .set(as(ownerToken))
        .send({ retentionUntil: null })
        .expect(200);
      await http().delete(`/api/documents/${created.body.id}`).set(as(ownerToken)).expect(204);

      // Soft delete: invisible to everyone afterwards, including its own owner.
      await http().get(`/api/documents/${created.body.id}`).set(as(aToken)).expect(404);
      await http().get(`/api/documents/${created.body.id}`).set(as(ownerToken)).expect(404);
    });
  });

  describe('sick note attachment', () => {
    it('attaches a document the requester owns to their absence request', async () => {
      const doc = await upload(bToken, { title: 'Sick note 12 Aug', categoryId }, PDF_HEADER).expect(201);

      const types = await http().get('/api/absences/types').set(as(bToken)).expect(200);
      const sick = types.body.find((t: { key: string }) => t.key === 'sick');

      const monday = (() => {
        const now = new Date();
        now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7) + 28);
        return now.toISOString().slice(0, 10);
      })();

      const absence = await http()
        .post('/api/absences')
        .set(as(bToken))
        .send({ typeId: sick.id, startsOn: monday, endsOn: monday, documentId: doc.body.id })
        .expect(201);

      expect(absence.body.documentId).toBe(doc.body.id);
      expect(absence.body.documentTitle).toBe('Sick note 12 Aug');
    });

    it('404s a document the requester cannot see at all — that 404 is the enforcement', async () => {
      const doc = await upload(aToken, { title: "A's private file", categoryId }, PDF_HEADER).expect(
        201,
      );

      const types = await http().get('/api/absences/types').set(as(bToken)).expect(200);
      const sick = types.body.find((t: { key: string }) => t.key === 'sick');
      const day = (() => {
        const now = new Date();
        now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7) + 35);
        return now.toISOString().slice(0, 10);
      })();

      await http()
        .post('/api/absences')
        .set(as(bToken))
        .send({ typeId: sick.id, startsOn: day, endsOn: day, documentId: doc.body.id })
        .expect(404);
    });

    it('refuses a document that is visible but belongs to someone other than the subject', async () => {
      const doc = await upload(aToken, { title: "A's own file", categoryId }, PDF_HEADER).expect(201);

      const types = await http().get('/api/absences/types').set(as(ownerToken)).expect(200);
      const sick = types.body.find((t: { key: string }) => t.key === 'sick');
      const day = (() => {
        const now = new Date();
        now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7) + 42);
        return now.toISOString().slice(0, 10);
      })();

      // The owner holds document:manage and holiday:approve, so A's document is
      // visible and raising for someone else is allowed — the refusal has to be the
      // ownership check, not a visibility 404.
      await http()
        .post('/api/absences')
        .set(as(ownerToken))
        .send({ typeId: sick.id, startsOn: day, endsOn: day, userId: bId, documentId: doc.body.id })
        .expect(400);
    });
  });
});
