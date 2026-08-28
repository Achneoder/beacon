import { describe, expect, it, vi } from 'vitest';
import type { Permission } from '@beacon/shared';
import { SearchService, type SearchHit } from '../../common/search/search.service.js';
import type { DocumentsService } from '../documents/documents.service.js';
import type { UsersService } from '../users/users.service.js';
import { SearchQueryService } from './search-query.service.js';

/**
 * This spec is about the phase's central claim: the index answers what matched, and
 * the *database* answers who may see it. So the search double here is deliberately
 * naive — it returns whatever it is told to, including things the caller has no
 * business seeing — and the assertions are about what survives.
 */

function searchDouble(hits: SearchHit[]) {
  return {
    available: () => true,
    query: vi.fn().mockResolvedValue(hits),
  } as unknown as SearchService & { query: ReturnType<typeof vi.fn> };
}

/** Rows the database is willing to hand back, keyed by id. */
function documentsDouble(visible: { id: string; title: string; category: string }[]) {
  return {
    findVisibleByIds: vi.fn(async (_caller: unknown, ids: string[]) =>
      visible
        .filter((document) => ids.includes(document.id))
        .map((document) => ({
          id: document.id,
          title: document.title,
          category: { getEntity: () => ({ name: document.category }) },
        })),
    ),
  } as unknown as DocumentsService & { findVisibleByIds: ReturnType<typeof vi.fn> };
}

function usersDouble(visible: { id: string; firstName: string; lastName: string }[]) {
  return {
    findByIds: vi.fn(async (_organizationId: string, ids: string[]) =>
      visible
        .filter((user) => ids.includes(user.id))
        .map((user) => ({ ...user, jobTitle: null })),
    ),
  } as unknown as UsersService & { findByIds: ReturnType<typeof vi.fn> };
}

function callerWith(permissions: Permission[]) {
  return { id: 'me', organizationId: 'org-1', permissions };
}

describe('SearchQueryService', () => {
  it('drops a hit the database will not hand back', async () => {
    // The engine matched someone else's payslip. The database returns only the
    // document this caller owns, and the other one has to vanish — not 403, not an
    // empty-titled row, gone.
    const search = searchDouble([
      { id: 'mine', type: 'document' },
      { id: 'theirs', type: 'document' },
    ]);
    const service = new SearchQueryService(
      search,
      documentsDouble([{ id: 'mine', title: 'My payslip', category: 'Payslips' }]),
      usersDouble([]),
    );

    const { results } = await service.query(callerWith(['document:read']), 'payslip');

    expect(results.map((result) => result.id)).toEqual(['mine']);
  });

  it('keeps the engine ordering rather than the database ordering', async () => {
    // Relevance is the one thing the search backend is actually for; `id IN (...)`
    // comes back in whatever order Postgres feels like.
    const search = searchDouble([
      { id: 'b', type: 'document' },
      { id: 'a', type: 'document' },
    ]);
    const service = new SearchQueryService(
      search,
      documentsDouble([
        { id: 'a', title: 'A', category: 'Contracts' },
        { id: 'b', title: 'B', category: 'Contracts' },
      ]),
      usersDouble([]),
    );

    const { results } = await service.query(callerWith(['document:read']), 'contract');

    expect(results.map((result) => result.id)).toEqual(['b', 'a']);
  });

  it('searches only the types the caller may read', async () => {
    const search = searchDouble([]);
    const service = new SearchQueryService(search, documentsDouble([]), usersDouble([]));

    await service.query(callerWith(['employee:read']), 'lena');

    expect(search.query).toHaveBeenCalledWith(expect.objectContaining({ types: ['employee'] }));
  });

  it('returns nothing, rather than refusing, for a caller who may read neither', async () => {
    // The endpoint spans two features. A 403 for the half they were not asking about
    // would be the wrong answer — see the comment on `allowedTypes`.
    const search = searchDouble([]);
    const service = new SearchQueryService(search, documentsDouble([]), usersDouble([]));

    const response = await service.query(callerWith([]), 'anything');

    expect(response.results).toEqual([]);
    expect(search.query).not.toHaveBeenCalled();
  });

  it('never queries the engine for a term too short to mean anything', async () => {
    const search = searchDouble([]);
    const service = new SearchQueryService(search, documentsDouble([]), usersDouble([]));

    await service.query(callerWith(['document:read']), 'a');

    expect(search.query).not.toHaveBeenCalled();
  });

  it('scopes the engine query by the caller organization, never the query string', async () => {
    const search = searchDouble([]);
    const service = new SearchQueryService(search, documentsDouble([]), usersDouble([]));

    await service.query(callerWith(['document:read']), 'contract');

    expect(search.query).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
    );
  });

  it('points a person at their profile and a document at the documents screen', async () => {
    const search = searchDouble([
      { id: 'doc-1', type: 'document' },
      { id: 'user-1', type: 'employee' },
    ]);
    const service = new SearchQueryService(
      search,
      documentsDouble([{ id: 'doc-1', title: 'Contract', category: 'Employment contract' }]),
      usersDouble([{ id: 'user-1', firstName: 'Lena', lastName: 'Hartmann' }]),
    );

    const { results } = await service.query(
      callerWith(['document:read', 'employee:read']),
      'contract',
    );

    expect(results).toEqual([
      {
        type: 'document',
        id: 'doc-1',
        title: 'Contract',
        subtitle: 'Employment contract',
        href: '/documents?open=doc-1',
      },
      {
        type: 'employee',
        id: 'user-1',
        title: 'Lena Hartmann',
        subtitle: null,
        href: '/people/user-1',
      },
    ]);
  });

  it('degrades to no results when the backend is down, rather than failing the request', async () => {
    // A search container that is unreachable is not an application error — the
    // popover shows "no matches" either way, and a 500 would buy only noise.
    const search = {
      available: () => true,
      query: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as SearchService;
    const service = new SearchQueryService(search, documentsDouble([]), usersDouble([]));

    await expect(service.query(callerWith(['document:read']), 'contract')).resolves.toEqual({
      results: [],
      available: true,
    });
  });

  it('says search is unavailable when no backend is configured', async () => {
    const search = {
      available: () => false,
      query: vi.fn(),
    } as unknown as SearchService & { query: ReturnType<typeof vi.fn> };
    const service = new SearchQueryService(search, documentsDouble([]), usersDouble([]));

    const response = await service.query(callerWith(['document:read']), 'contract');

    expect(response).toEqual({ results: [], available: false });
    expect(search.query).not.toHaveBeenCalled();
  });
});
