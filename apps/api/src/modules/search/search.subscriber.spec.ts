import { describe, expect, it, vi } from 'vitest';
import { ChangeSetType, type FlushEventArgs } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/core';
import { Document } from '../documents/document.entity.js';
import { User, UserStatus } from '../users/user.entity.js';
import { SearchIndexer } from './search-indexer.service.js';
import { SearchSubscriber } from './search.subscriber.js';

/**
 * The subscriber decides *what* happens to the index on a write, and the two rules
 * worth pinning are the two that are easy to get backwards: a soft-deleted document
 * has to leave the index even though it arrives as an update, and a disabled user has
 * to stay in it even though a disable is Beacon's soft delete for people.
 */

function changeSetsOf(...entries: { entity: object; type?: ChangeSetType }[]): FlushEventArgs {
  return {
    uow: {
      getChangeSets: () =>
        entries.map(({ entity, type = ChangeSetType.UPDATE }) => ({ entity, type })),
    },
  } as unknown as FlushEventArgs;
}

function documentEntity(id: string, deletedAt: Date | null): Document {
  return Object.assign(Object.create(Document.prototype) as Document, {
    id,
    organization: { id: 'org-1' },
    deletedAt,
  });
}

function userEntity(id: string, status: UserStatus): User {
  return Object.assign(Object.create(User.prototype) as User, {
    id,
    organization: { id: 'org-1' },
    status,
  });
}

/** The indexer, stubbed down to the two calls the subscriber is allowed to make. */
function indexerDouble() {
  return {
    enabled: true,
    indexQuietly: vi.fn().mockResolvedValue(undefined),
    removeQuietly: vi.fn().mockResolvedValue(undefined),
  } as unknown as SearchIndexer & {
    indexQuietly: ReturnType<typeof vi.fn>;
    removeQuietly: ReturnType<typeof vi.fn>;
  };
}

function subscriberWith(indexer: ReturnType<typeof indexerDouble>): SearchSubscriber {
  return new SearchSubscriber({} as MikroORM, indexer);
}

/** `afterFlush` intentionally does not await its own work — see the comment there. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('SearchSubscriber', () => {
  it('indexes a document that was created or changed', async () => {
    const indexer = indexerDouble();

    subscriberWith(indexer).afterFlush(
      changeSetsOf({ entity: documentEntity('doc-1', null), type: ChangeSetType.CREATE }),
    );
    await settle();

    expect(indexer.indexQuietly).toHaveBeenCalledWith('document', ['doc-1']);
    expect(indexer.removeQuietly).not.toHaveBeenCalled();
  });

  it('removes a soft-deleted document, which arrives as an update', async () => {
    const indexer = indexerDouble();

    // What `DocumentsService.remove` actually does: set deletedAt, then flush.
    subscriberWith(indexer).afterFlush(
      changeSetsOf({ entity: documentEntity('doc-1', new Date()), type: ChangeSetType.UPDATE }),
    );
    await settle();

    expect(indexer.removeQuietly).toHaveBeenCalledWith('document', 'org-1', ['doc-1']);
    expect(indexer.indexQuietly).not.toHaveBeenCalled();
  });

  it('keeps a disabled user indexed', async () => {
    const indexer = indexerDouble();

    // Disabling is the soft delete for people, but an admin still has to be able to
    // find the account they just disabled. What a *caller* may see is decided on read.
    subscriberWith(indexer).afterFlush(
      changeSetsOf({ entity: userEntity('user-1', UserStatus.Disabled) }),
    );
    await settle();

    expect(indexer.indexQuietly).toHaveBeenCalledWith('employee', ['user-1']);
    expect(indexer.removeQuietly).not.toHaveBeenCalled();
  });

  it('batches one flush into one call per type', async () => {
    const indexer = indexerDouble();

    subscriberWith(indexer).afterFlush(
      changeSetsOf(
        { entity: documentEntity('doc-1', null) },
        { entity: documentEntity('doc-2', null) },
        { entity: userEntity('user-1', UserStatus.Active) },
      ),
    );
    await settle();

    expect(indexer.indexQuietly).toHaveBeenCalledTimes(2);
    expect(indexer.indexQuietly).toHaveBeenCalledWith('document', ['doc-1', 'doc-2']);
    expect(indexer.indexQuietly).toHaveBeenCalledWith('employee', ['user-1']);
  });

  it('ignores entities that are not indexed at all', async () => {
    const indexer = indexerDouble();

    subscriberWith(indexer).afterFlush(changeSetsOf({ entity: { id: 'whatever' } }));
    await settle();

    expect(indexer.indexQuietly).not.toHaveBeenCalled();
    expect(indexer.removeQuietly).not.toHaveBeenCalled();
  });

  it('does no work at all when no search backend is configured', async () => {
    const indexer = indexerDouble();
    Object.defineProperty(indexer, 'enabled', { value: false });

    subscriberWith(indexer).afterFlush(changeSetsOf({ entity: documentEntity('doc-1', null) }));
    await settle();

    expect(indexer.indexQuietly).not.toHaveBeenCalled();
  });
});
