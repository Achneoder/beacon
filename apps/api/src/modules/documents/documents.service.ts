import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  LockMode,
  UniqueConstraintViolationException,
  ref,
  type FilterQuery,
} from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  ACCEPTED_DOCUMENT_TYPES,
  DEFAULT_DOCUMENT_CATEGORIES,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_DOCUMENT_BYTES,
  fullName,
  type DocumentAccessSummary,
  type DocumentCategorySummary,
  type DocumentDetail,
  type DocumentDownload,
  type DocumentSummary,
  type DocumentUploadPolicy,
  type DocumentVersionSummary,
} from '@beacon/shared';
import { StorageService, type StoredObject } from '../../common/storage/storage.service.js';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { Department } from '../departments/department.entity.js';
import { Role } from '../roles/role.entity.js';
import { DocumentCategory } from './document-category.entity.js';
import { Document } from './document.entity.js';
import { DocumentVersion } from './document-version.entity.js';
import { DocumentAccess } from './document-access.entity.js';
import type { UploadedDocumentFile } from './document-file.pipe.js';
import type { CreateDocumentDto } from './dto/create-document.dto.js';
import type { UpdateDocumentDto } from './dto/update-document.dto.js';
import type { GrantDocumentAccessDto } from './dto/grant-document-access.dto.js';
import type { CreateDocumentCategoryDto } from './dto/create-document-category.dto.js';

/** Who is asking, and how far `document:manage` already lets them see. */
export interface DocumentCaller {
  id: string;
  organizationId: string;
  canManage: boolean;
}

/** `org/<orgId>/documents/<docId>/<versionId>` — ids only, so no filename or path
 *  segment can ever traverse a directory or cross a tenant. */
function documentKey(organizationId: string, documentId: string, versionId: string): string {
  return `org/${organizationId}/documents/${documentId}/${versionId}`;
}

const TODAY = (): string => new Date().toISOString().slice(0, 10);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly em: EntityManager,
    private readonly users: UsersService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- visibility

  /**
   * Department and role ids are read from the database on every call rather than
   * carried on the caller — the access token holds only permissions, and a
   * department move must take effect the moment it happens, not fifteen minutes
   * later when the token expires. Skipped entirely for a caller who already holds
   * `document:manage`.
   */
  private async subjectsOf(
    caller: DocumentCaller,
  ): Promise<{ departmentId: string | null; roleIds: string[] }> {
    const user = await this.users.findEntity(caller.organizationId, caller.id);

    return {
      departmentId: user.department?.id ?? null,
      roleIds: user.roles.getItems().map((role) => role.id),
    };
  }

  /**
   * The one place every read path resolves what a caller may see, so a new route
   * cannot forget it. Grants are prefetched rather than expressed as a filter on the
   * `access` collection inside the `$or` below: a collection filter there would make
   * MikroORM join and fan rows out, which breaks ordering and pagination later. A
   * person holds tens of grants, not thousands, so one bounded extra query buys a SQL
   * shape that stays simple.
   */
  private async accessContext(
    caller: DocumentCaller,
  ): Promise<{ where: Record<string, unknown>; writeGrantedIds: Set<string> }> {
    const where: Record<string, unknown> = { organization: caller.organizationId, deletedAt: null };
    if (caller.canManage) return { where, writeGrantedIds: new Set() };

    const { departmentId, roleIds } = await this.subjectsOf(caller);
    const subjects: FilterQuery<DocumentAccess>[] = [{ user: caller.id }];
    if (departmentId) subjects.push({ department: departmentId });
    if (roleIds.length > 0) subjects.push({ role: { $in: roleIds } });

    const grants = await this.em.find(
      DocumentAccess,
      { organization: caller.organizationId, $or: subjects },
      { fields: ['document', 'level'] },
    );
    const grantedIds = grants.map((grant) => grant.document.id);
    const writeGrantedIds = new Set(
      grants.filter((grant) => grant.level === 'write').map((grant) => grant.document.id),
    );

    where.$or = [
      { owner: caller.id },
      { owner: null },
      ...(grantedIds.length > 0 ? [{ id: { $in: grantedIds } }] : []),
    ];

    return { where, writeGrantedIds };
  }

  /**
   * 404, never 403, for a document the caller cannot see — for a payslip or a sick
   * note, existence is itself the secret, and the id is an unguessable uuid the
   * caller could only have guessed. Identical response for another tenant's document
   * and for an id that does not exist at all.
   */
  async findVisible(
    caller: DocumentCaller,
    id: string,
    populate: readonly string[] = ['owner', 'category', 'currentVersion'],
  ): Promise<Document> {
    const { where } = await this.accessContext(caller);
    const document = await this.em.findOne(
      Document,
      { id, ...where },
      { populate: populate as never },
    );
    if (!document) throw new NotFoundException('document not found');

    return document;
  }

  /** May this caller write a new version into an already-visible document. Writing
   *  still needs `document:manage`, ownership, or an explicit `write` grant — an
   *  organization-wide document reads for everyone but is not writable by everyone,
   *  or any employee could replace the handbook. */
  private async assertCanWrite(document: Document, caller: DocumentCaller): Promise<void> {
    if (caller.canManage) return;
    if (document.owner && document.owner.id === caller.id) return;

    const { departmentId, roleIds } = await this.subjectsOf(caller);
    const subjects: FilterQuery<DocumentAccess>[] = [{ user: caller.id }];
    if (departmentId) subjects.push({ department: departmentId });
    if (roleIds.length > 0) subjects.push({ role: { $in: roleIds } });

    const grant = await this.em.findOne(DocumentAccess, {
      document: document.id,
      organization: caller.organizationId,
      level: 'write',
      $or: subjects,
    });
    if (!grant) throw new ForbiddenException('you may not add a version to this document');
  }

  private async resolveOwner(
    caller: DocumentCaller,
    dto: { ownerId?: string | null; organizationWide?: boolean },
  ): Promise<User | null> {
    if (dto.organizationWide) {
      if (!caller.canManage) {
        throw new ForbiddenException("writing into someone else's documents needs document:manage");
      }
      return null;
    }

    const ownerId = dto.ownerId ?? caller.id;
    if (ownerId !== caller.id && !caller.canManage) {
      throw new ForbiddenException("writing into someone else's documents needs document:manage");
    }

    return this.users.findEntity(caller.organizationId, ownerId);
  }

  // ---------------------------------------------------------------- documents

  async list(
    caller: DocumentCaller,
    filter: { categoryId?: string; userId?: string } = {},
  ): Promise<DocumentSummary[]> {
    const { where, writeGrantedIds } = await this.accessContext(caller);

    if (filter.categoryId) where.category = filter.categoryId;
    if (filter.userId) where.owner = filter.userId;

    const documents = await this.em.find(Document, where, {
      populate: ['owner', 'category', 'currentVersion'],
      orderBy: { createdAt: 'desc' },
    });

    return documents
      .filter((document) => document.currentVersion)
      .map((document) =>
        toDocumentSummary(document, document.currentVersion!.getEntity(), caller, writeGrantedIds),
      );
  }

  async get(caller: DocumentCaller, id: string): Promise<DocumentDetail> {
    const { where, writeGrantedIds } = await this.accessContext(caller);
    const document = await this.em.findOne(
      Document,
      { id, ...where },
      {
        populate: [
          'owner',
          'category',
          'currentVersion',
          'versions',
          'versions.uploadedBy',
          'access',
          'access.user',
          'access.department',
          'access.role',
        ],
      },
    );
    if (!document || !document.currentVersion) throw new NotFoundException('document not found');

    const summary = toDocumentSummary(
      document,
      document.currentVersion.getEntity(),
      caller,
      writeGrantedIds,
    );
    const versions = document.versions
      .getItems()
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(toVersionSummary);
    const access = document.access
      .getItems()
      .map((grant) => toAccessSummary(grant, subjectNameOf(grant)));

    return { ...summary, versions, access };
  }

  async listVersions(caller: DocumentCaller, id: string): Promise<DocumentVersionSummary[]> {
    const document = await this.findVisible(caller, id, ['versions', 'versions.uploadedBy']);

    return document.versions
      .getItems()
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(toVersionSummary);
  }

  async download(caller: DocumentCaller, id: string, versionId?: string): Promise<DocumentDownload> {
    const document = await this.findVisible(caller, id, ['currentVersion']);

    let version: DocumentVersion;
    if (versionId) {
      const found = await this.em.findOne(DocumentVersion, {
        id: versionId,
        document: document.id,
        organization: caller.organizationId,
      });
      if (!found) throw new NotFoundException('document not found');
      version = found;
    } else {
      const current = document.currentVersion?.getEntity();
      if (!current) throw new NotFoundException('document not found');
      version = current;
    }

    const url = await this.storage.signedUrl(version.storageKey, DOWNLOAD_URL_TTL_SECONDS);

    return {
      url,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      filename: version.originalFilename,
      contentType: version.contentType,
      size: version.size,
      versionId: version.id,
    };
  }

  uploadPolicy(): DocumentUploadPolicy {
    return {
      maxBytes: MAX_DOCUMENT_BYTES,
      acceptedTypes: [...ACCEPTED_DOCUMENT_TYPES],
      acceptedExtensions: [...ACCEPTED_DOCUMENT_EXTENSIONS],
      encryptedAtRest: this.storage.encryptedAtRest(),
    };
  }

  /**
   * Object first, then the row: `BaseEntity` generates both ids client-side, so the
   * storage key is known before any SQL runs. A storage failure has touched nothing;
   * a database failure after a successful upload gets a best-effort compensating
   * delete. The asymmetry is deliberate — a stray, unreferenced object is harmless,
   * a row pointing at bytes that are not there is not.
   */
  async create(
    caller: DocumentCaller,
    dto: CreateDocumentDto,
    file: UploadedDocumentFile,
  ): Promise<DocumentSummary> {
    const category = await this.em.findOne(DocumentCategory, {
      id: dto.categoryId,
      organization: caller.organizationId,
      active: true,
    });
    if (!category) throw new NotFoundException('document category not found');

    const owner = await this.resolveOwner(caller, dto);

    const document = this.em.create(Document, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      owner: owner ? ref(owner) : null,
      title: dto.title,
      category: ref(category),
      retentionUntil: dto.retentionUntil ?? null,
    });

    const versionId = randomUUID();
    const key = documentKey(caller.organizationId, document.id, versionId);

    const stored = await this.putOrRefuse(key, file);

    const version = this.em.create(DocumentVersion, {
      id: versionId,
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      document: ref(document),
      versionNumber: 1,
      storageKey: key,
      size: stored.size,
      contentType: stored.contentType,
      checksum: file.checksum,
      originalFilename: file.originalFilename,
      uploadedBy: this.em.getReference(User, caller.id, { wrapped: true }),
    });
    document.currentVersion = ref(version);

    try {
      await this.em.flush();
    } catch (error) {
      await this.storage.delete(key).catch(() => {});
      throw error;
    }

    await this.em.populate(document, ['owner', 'category', 'currentVersion']);
    await this.em.populate(version, ['uploadedBy']);

    return toDocumentSummary(document, version, caller, new Set());
  }

  /**
   * `versionNumber` is allocated under a pessimistic lock on the parent, never
   * `count() + 1` — two concurrent uploads must not compute the same number. The
   * upload itself still happens before the transaction opens, so a slow call to the
   * object store never holds that row lock; `versionId` is generated up front so a
   * retry after a storage failure never collides in the bucket.
   */
  async addVersion(
    caller: DocumentCaller,
    id: string,
    file: UploadedDocumentFile,
  ): Promise<DocumentVersionSummary> {
    const document = await this.findVisible(caller, id, []);
    await this.assertCanWrite(document, caller);

    const versionId = randomUUID();
    const key = documentKey(caller.organizationId, document.id, versionId);
    const stored = await this.putOrRefuse(key, file);

    try {
      const version = await this.em.transactional(async (em) => {
        const locked = await em.findOneOrFail(
          Document,
          { id: document.id, organization: caller.organizationId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        const last = await em.findOne(
          DocumentVersion,
          { document: locked.id },
          { orderBy: { versionNumber: 'desc' } },
        );

        const created = em.create(DocumentVersion, {
          id: versionId,
          organization: em.getReference(Organization, caller.organizationId, { wrapped: true }),
          document: ref(locked),
          versionNumber: (last?.versionNumber ?? 0) + 1,
          storageKey: key,
          size: stored.size,
          contentType: stored.contentType,
          checksum: file.checksum,
          originalFilename: file.originalFilename,
          uploadedBy: em.getReference(User, caller.id, { wrapped: true }),
        });
        locked.currentVersion = ref(created);

        await em.flush();
        return created;
      });

      await this.em.populate(version, ['uploadedBy']);
      return toVersionSummary(version);
    } catch (error) {
      await this.storage.delete(key).catch(() => {});
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException('another version was uploaded at the same time; try again');
      }
      throw error;
    }
  }

  private async putOrRefuse(key: string, file: UploadedDocumentFile): Promise<StoredObject> {
    try {
      return await this.storage.put(key, file.buffer, file.contentType);
    } catch {
      throw new ServiceUnavailableException('the document store is unavailable');
    }
  }

  async update(caller: DocumentCaller, id: string, dto: UpdateDocumentDto): Promise<DocumentSummary> {
    const document = await this.em.findOne(
      Document,
      { id, organization: caller.organizationId, deletedAt: null },
      { populate: ['owner', 'category', 'currentVersion'] },
    );
    if (!document || !document.currentVersion) throw new NotFoundException('document not found');

    if (dto.title !== undefined) document.title = dto.title;
    if (dto.retentionUntil !== undefined) document.retentionUntil = dto.retentionUntil;
    if (dto.categoryId !== undefined) {
      const category = await this.em.findOne(DocumentCategory, {
        id: dto.categoryId,
        organization: caller.organizationId,
        active: true,
      });
      if (!category) throw new NotFoundException('document category not found');
      document.category = ref(category);
    }

    await this.em.flush();
    await this.em.populate(document, ['category']);

    return toDocumentSummary(document, document.currentVersion.getEntity(), caller, new Set());
  }

  /** Soft delete — the bytes stay, and a `retentionUntil` in the future refuses it
   *  outright rather than letting a tidy-up strip evidence a phase 3 sick leave
   *  still needs. */
  async remove(caller: DocumentCaller, id: string): Promise<void> {
    const document = await this.em.findOne(Document, {
      id,
      organization: caller.organizationId,
      deletedAt: null,
    });
    if (!document) throw new NotFoundException('document not found');

    if (document.retentionUntil && document.retentionUntil > TODAY()) {
      throw new BadRequestException(`this document is retained until ${document.retentionUntil}`);
    }

    document.deletedAt = new Date();
    document.deletedBy = this.em.getReference(User, caller.id, { wrapped: true });
    await this.em.flush();
  }

  // ---------------------------------------------------------------- access

  async grantAccess(
    caller: DocumentCaller,
    id: string,
    dto: GrantDocumentAccessDto,
  ): Promise<DocumentAccessSummary> {
    const document = await this.em.findOne(Document, {
      id,
      organization: caller.organizationId,
      deletedAt: null,
    });
    if (!document) throw new NotFoundException('document not found');

    const access = this.em.create(DocumentAccess, {
      organization: this.em.getReference(Organization, caller.organizationId, { wrapped: true }),
      document: ref(document),
      subject: dto.subject,
      level: dto.level ?? 'read',
      grantedBy: this.em.getReference(User, caller.id, { wrapped: true }),
    });

    let subjectName: string;
    if (dto.subject === 'user') {
      const user = await this.users.findEntity(caller.organizationId, dto.subjectId);
      access.user = ref(user);
      subjectName = fullName(user);
    } else if (dto.subject === 'department') {
      const department = await this.em.findOne(Department, {
        id: dto.subjectId,
        organization: caller.organizationId,
      });
      if (!department) throw new NotFoundException('department not found');
      access.department = ref(department);
      subjectName = department.name;
    } else {
      const role = await this.em.findOne(Role, { id: dto.subjectId, organization: caller.organizationId });
      if (!role) throw new NotFoundException('role not found');
      access.role = ref(role);
      subjectName = role.name;
    }

    try {
      await this.em.flush();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException('that grant already exists');
      }
      throw error;
    }

    return toAccessSummary(access, subjectName);
  }

  async revokeAccess(caller: DocumentCaller, id: string, accessId: string): Promise<void> {
    const access = await this.em.findOne(DocumentAccess, {
      id: accessId,
      document: id,
      organization: caller.organizationId,
    });
    if (!access) throw new NotFoundException('access grant not found');

    await this.em.removeAndFlush(access);
  }

  // ---------------------------------------------------------------- categories

  /**
   * Seeded on first read, mirroring `AbsencesService.listTypes`/`seedTypes` — an
   * organization that predates this phase fills itself in the first time its
   * documents screen loads, and the unique key on `(organization, key)` turns a
   * concurrent double-seed into a conflict rather than a duplicate list.
   */
  async listCategories(organizationId: string, includeInactive = false): Promise<DocumentCategorySummary[]> {
    let categories = await this.em.find(
      DocumentCategory,
      { organization: organizationId },
      { orderBy: { position: 'asc', name: 'asc' } },
    );
    if (categories.length === 0) categories = await this.seedCategories(organizationId);

    return categories.filter((category) => includeInactive || category.active).map(toCategorySummary);
  }

  async createCategory(
    organizationId: string,
    dto: CreateDocumentCategoryDto,
  ): Promise<DocumentCategorySummary> {
    const existing = await this.em.count(DocumentCategory, { organization: organizationId, key: dto.key });
    if (existing > 0) throw new BadRequestException('that key is already in use');

    const category = this.em.create(DocumentCategory, {
      organization: this.em.getReference(Organization, organizationId, { wrapped: true }),
      key: dto.key,
      name: dto.name,
      position: dto.position ?? 0,
      active: true,
    });
    await this.em.flush();

    return toCategorySummary(category);
  }

  /** Retiring a category rather than deleting it — documents already filed under it
   *  must keep naming theirs. */
  async retireCategory(organizationId: string, id: string): Promise<DocumentCategorySummary> {
    const category = await this.em.findOne(DocumentCategory, { id, organization: organizationId });
    if (!category) throw new NotFoundException('document category not found');

    category.active = false;
    await this.em.flush();

    return toCategorySummary(category);
  }

  private async seedCategories(organizationId: string): Promise<DocumentCategory[]> {
    const organization = this.em.getReference(Organization, organizationId, { wrapped: true });
    const created = DEFAULT_DOCUMENT_CATEGORIES.map((seed, position) =>
      this.em.create(DocumentCategory, { organization, ...seed, active: true, position }),
    );
    await this.em.flush();

    return created;
  }
}

function toCategorySummary(category: DocumentCategory): DocumentCategorySummary {
  return {
    id: category.id,
    key: category.key,
    name: category.name,
    position: category.position,
    active: category.active,
  };
}

function toDocumentSummary(
  document: Document,
  version: DocumentVersion,
  caller: DocumentCaller,
  writeGrantedIds: Set<string>,
): DocumentSummary {
  const owner = document.owner?.getEntity() ?? null;
  const category = document.category.getEntity();
  const uploadedBy = version.uploadedBy?.getEntity() ?? null;

  return {
    id: document.id,
    title: document.title,
    categoryId: category.id,
    categoryName: category.name,
    ownerId: owner?.id ?? null,
    ownerName: owner ? fullName(owner) : null,
    scope: owner ? 'personal' : 'organization',
    versionId: version.id,
    versionNumber: version.versionNumber,
    size: version.size,
    contentType: version.contentType,
    filename: version.originalFilename,
    uploadedAt: version.createdAt.toISOString(),
    uploadedById: uploadedBy?.id ?? null,
    uploadedByName: uploadedBy ? fullName(uploadedBy) : null,
    retentionUntil: document.retentionUntil,
    canWrite: caller.canManage || owner?.id === caller.id || writeGrantedIds.has(document.id),
    canManage: caller.canManage,
  };
}

function toVersionSummary(version: DocumentVersion): DocumentVersionSummary {
  const uploadedBy = version.uploadedBy?.getEntity() ?? null;

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    size: version.size,
    contentType: version.contentType,
    filename: version.originalFilename,
    checksum: version.checksum,
    uploadedAt: version.createdAt.toISOString(),
    uploadedById: uploadedBy?.id ?? null,
    uploadedByName: uploadedBy ? fullName(uploadedBy) : null,
  };
}

function toAccessSummary(access: DocumentAccess, subjectName: string): DocumentAccessSummary {
  const subjectId =
    access.subject === 'user'
      ? access.user?.id
      : access.subject === 'department'
        ? access.department?.id
        : access.role?.id;

  return {
    id: access.id,
    subject: access.subject,
    subjectId: subjectId ?? '',
    subjectName,
    level: access.level,
    grantedAt: access.createdAt.toISOString(),
  };
}

/** Reads the display name off whichever populated relation the grant points at —
 *  the read path already has it loaded, unlike `grantAccess`, which resolves it
 *  while validating the subject and passes it in directly. */
function subjectNameOf(access: DocumentAccess): string {
  if (access.subject === 'user') {
    const user = access.user?.getEntity();
    return user ? fullName(user) : '';
  }
  if (access.subject === 'department') {
    return access.department?.getEntity().name ?? '';
  }
  return access.role?.getEntity().name ?? '';
}
