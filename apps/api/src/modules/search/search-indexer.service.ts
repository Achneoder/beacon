import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { fullName, type SearchResultType } from '@beacon/shared';
import {
  SearchService,
  type SearchRecord,
} from '../../common/search/search.service.js';
import { Document } from '../documents/document.entity.js';
import { User } from '../users/user.entity.js';

/**
 * Turns rows into `SearchRecord`s and pushes them at the seam.
 *
 * Everything indexable is re-read here from its id rather than taken from whatever
 * the caller happened to have in memory: the subscriber sees entities mid-flush with
 * relations that may not be loaded, and a record built from a half-populated
 * `Document` would silently index a document with no category name. One extra query
 * off the request path is a fair price for records that are always complete.
 */
@Injectable()
export class SearchIndexer {
  private readonly logger = new Logger(SearchIndexer.name);

  constructor(
    private readonly em: EntityManager,
    private readonly search: SearchService,
  ) {}

  get enabled(): boolean {
    return this.search.available();
  }

  // ------------------------------------------------------------- building

  async documentRecords(ids: string[]): Promise<SearchRecord[]> {
    if (ids.length === 0) return [];

    const documents = await this.em.fork().find(
      Document,
      { id: { $in: ids }, deletedAt: null },
      { populate: ['category', 'currentVersion'] },
    );

    return documents.map((document) => {
      const version = document.currentVersion?.getEntity();

      return {
        id: document.id,
        type: 'document' as const,
        organizationId: document.organization.id,
        title: document.title,
        subtitle: document.category.getEntity().name,
        // The filename is worth matching but not showing — people look for
        // "payslip-2026-03.pdf" as readily as for the title someone typed.
        keywords: version ? [version.originalFilename] : [],
        updatedAt: document.updatedAt.getTime(),
      };
    });
  }

  async employeeRecords(ids: string[]): Promise<SearchRecord[]> {
    if (ids.length === 0) return [];

    const users = await this.em.fork().find(User, { id: { $in: ids } });

    return users.map((user) => ({
      id: user.id,
      type: 'employee' as const,
      organizationId: user.organization.id,
      title: fullName(user),
      subtitle: user.jobTitle,
      keywords: [user.email, user.employeeNumber].filter((value): value is string => !!value),
      updatedAt: user.updatedAt.getTime(),
    }));
  }

  // ------------------------------------------------------------- writing

  /**
   * Never throws and never blocks the caller's own work. Indexing is an enhancement
   * to a write that has already succeeded — the same contract `MailService.send`
   * keeps, where an invitation is committed and stays valid whether or not the
   * email left the building. A search index that missed an update is repaired by
   * the next write to that row, or by `reindex`.
   */
  async indexQuietly(type: SearchResultType, ids: string[]): Promise<void> {
    if (!this.enabled || ids.length === 0) return;

    try {
      const records =
        type === 'document' ? await this.documentRecords(ids) : await this.employeeRecords(ids);
      await this.search.index(records);
    } catch (error) {
      this.logger.warn(`could not index ${ids.length} ${type} record(s): ${describe(error)}`);
    }
  }

  async removeQuietly(
    type: SearchResultType,
    organizationId: string,
    ids: string[],
  ): Promise<void> {
    if (!this.enabled || ids.length === 0) return;

    try {
      await this.search.remove(type, organizationId, ids);
    } catch (error) {
      this.logger.warn(`could not remove ${ids.length} ${type} record(s): ${describe(error)}`);
    }
  }

  // ------------------------------------------------------------- rebuild

  /**
   * Rebuilds an organization from Postgres and *waits*, unlike every other write
   * here — a caller who asked for a rebuild is entitled to know it finished.
   *
   * This exists because the index is derived state with no boot-time backfill: a
   * fresh container, a wiped volume or a restore from backup leaves search silently
   * empty, and this is what fills it. Errors propagate rather than being swallowed,
   * because an admin pressing the button needs to be told it failed.
   */
  async reindex(organizationId: string): Promise<{ documents: number; employees: number }> {
    // Zeros rather than the row counts when there is no backend: reporting "indexed
    // 40 documents" after a no-op would be a lie the settings screen then repeats.
    if (!this.enabled) return { documents: 0, employees: 0 };

    const em = this.em.fork();

    const documentIds = (
      await em.find(Document, { organization: organizationId, deletedAt: null }, { fields: ['id'] })
    ).map((document) => document.id);
    const userIds = (
      await em.find(User, { organization: organizationId }, { fields: ['id'] })
    ).map((user) => user.id);

    const documents = await this.documentRecords(documentIds);
    const employees = await this.employeeRecords(userIds);

    await this.search.replaceAll('document', organizationId, documents);
    await this.search.replaceAll('employee', organizationId, employees);

    return { documents: documents.length, employees: employees.length };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
