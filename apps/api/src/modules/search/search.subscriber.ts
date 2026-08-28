import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ChangeSetType,
  MikroORM,
  type EventSubscriber,
  type FlushEventArgs,
} from '@mikro-orm/core';
import type { SearchResultType } from '@beacon/shared';
import { Document } from '../documents/document.entity.js';
import { User } from '../users/user.entity.js';
import { SearchIndexer } from './search-indexer.service.js';

/** What one flush wants done, kept per organization so a batch can never cross one. */
type Pending = Map<string, { index: Set<string>; remove: Set<string> }>;

function bucket(pending: Pending, organizationId: string) {
  let entry = pending.get(organizationId);
  if (!entry) {
    entry = { index: new Set(), remove: new Set() };
    pending.set(organizationId, entry);
  }

  return entry;
}

/**
 * Re-indexes on write, through the unit of work rather than through calls sprinkled
 * across `DocumentsService` and `UsersService`. Every path that persists a document
 * or a user is covered by construction — including the ones that do not exist yet —
 * and no service has to remember to do anything.
 *
 * Registered here rather than through `createOrmConfig`, because the ORM factory in
 * `app.module.ts` runs before any other provider exists and could not be handed a
 * subscriber that needs injection.
 */
@Injectable()
export class SearchSubscriber implements EventSubscriber, OnModuleInit {
  constructor(
    private readonly orm: MikroORM,
    private readonly indexer: SearchIndexer,
  ) {}

  onModuleInit(): void {
    this.orm.em.getEventManager().registerSubscriber(this);
  }

  /**
   * `afterFlush`, not `afterCreate`/`afterUpdate`: ids are settled, the write has
   * committed, and one flush touching thirty rows becomes one indexing call rather
   * than thirty.
   *
   * Nothing here is awaited into the caller's promise — `void`, deliberately. A
   * search backend that is slow or down must not make a document upload slow or
   * failed, so the write returns and the index catches up. The cost is that search
   * is eventually consistent, which is why the e2e suite polls rather than asserting
   * once.
   */
  afterFlush(args: FlushEventArgs): void {
    if (!this.indexer.enabled) return;

    const documents: Pending = new Map();
    const employees: Pending = new Map();

    for (const changeSet of args.uow.getChangeSets()) {
      const entity = changeSet.entity;

      if (entity instanceof Document) {
        // A soft delete arrives as an *update*: `DocumentsService.remove` sets
        // `deletedAt` and flushes. Read as a change like any other it would
        // re-index a document meant to be gone, leaving it findable forever.
        const gone = changeSet.type === ChangeSetType.DELETE || entity.deletedAt !== null;
        record(bucket(documents, entity.organization.id), entity.id, gone);
      } else if (entity instanceof User) {
        // A disabled user stays indexed. `UserStatus.Disabled` is Beacon's soft
        // delete for people, but `UsersService.list` still returns them and an
        // admin has to be able to find the account they just disabled — so status
        // is not a reason to drop a record. Whether a *caller* may see one is the
        // database's decision on read, as always.
        const gone = changeSet.type === ChangeSetType.DELETE;
        record(bucket(employees, entity.organization.id), entity.id, gone);
      }
    }

    void this.drain('document', documents);
    void this.drain('employee', employees);
  }

  private async drain(type: SearchResultType, pending: Pending): Promise<void> {
    for (const [organizationId, { index, remove }] of pending) {
      if (remove.size > 0) await this.indexer.removeQuietly(type, organizationId, [...remove]);
      if (index.size > 0) await this.indexer.indexQuietly(type, [...index]);
    }
  }
}

function record(entry: { index: Set<string>; remove: Set<string> }, id: string, gone: boolean): void {
  if (gone) {
    entry.remove.add(id);
    entry.index.delete(id);
    return;
  }

  entry.index.add(id);
}
