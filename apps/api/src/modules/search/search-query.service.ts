import { Injectable, Logger } from '@nestjs/common';
import {
  SEARCH_MIN_TERM_LENGTH,
  SEARCH_RESULT_LIMIT,
  fullName,
  type Permission,
  type SearchResponse,
  type SearchResult,
  type SearchResultType,
} from '@beacon/shared';
import { SearchService, type SearchHit } from '../../common/search/search.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { UsersService } from '../users/users.service.js';

/**
 * How far to over-fetch from the engine before the database narrows the result down.
 *
 * A caller who may see one document in ten needs the engine to return more than the
 * eight rows the popover shows, or the post-filter empties the list. Four times is a
 * guess, but a bounded one: the query is still a single indexed lookup and a single
 * `id IN (...)`, and the alternative — paging the engine until enough survive — turns
 * one round trip into an unbounded loop.
 */
const OVERFETCH = 4;

export interface SearchCaller {
  id: string;
  organizationId: string;
  permissions: Permission[];
}

@Injectable()
export class SearchQueryService {
  private readonly logger = new Logger(SearchQueryService.name);

  constructor(
    private readonly search: SearchService,
    private readonly documents: DocumentsService,
    private readonly users: UsersService,
  ) {}

  /**
   * Which types this caller is even allowed to search. The endpoint itself declares
   * no `@RequirePermissions` because it spans two features: a manager with
   * `employee:read` and no `document:read` gets people and nothing else, rather than
   * a 403 for the half they cannot have. Same reasoning as `/approvals`, which
   * decides what to *show* rather than refusing outright.
   */
  private allowedTypes(caller: SearchCaller): SearchResultType[] {
    const types: SearchResultType[] = [];
    if (caller.permissions.includes('document:read')) types.push('document');
    if (caller.permissions.includes('employee:read')) types.push('employee');

    return types;
  }

  async query(
    caller: SearchCaller,
    term: string,
    requested: SearchResultType[] = [],
  ): Promise<SearchResponse> {
    const available = this.search.available();
    const trimmed = term.trim();

    let types = this.allowedTypes(caller);
    if (requested.length > 0) types = types.filter((type) => requested.includes(type));

    if (!available || trimmed.length < SEARCH_MIN_TERM_LENGTH || types.length === 0) {
      return { results: [], available };
    }

    let hits: SearchHit[];
    try {
      hits = await this.search.query({
        organizationId: caller.organizationId,
        term: trimmed,
        types,
        limit: SEARCH_RESULT_LIMIT * OVERFETCH,
      });
    } catch (error) {
      // A search backend that is down is not an application error. The popover shows
      // "no matches" either way — it treats a failed request as an empty one — so a
      // 500 here would buy nothing but noise and a broken-looking shell.
      this.logger.warn(`search query failed: ${describe(error)}`);

      return { results: [], available };
    }

    const resolved = await this.resolve(caller, hits);

    return { results: resolved.slice(0, SEARCH_RESULT_LIMIT), available };
  }

  /**
   * The load-bearing half of this phase.
   *
   * The index knows only what matched; it holds no owner, no grant and no
   * department, so it cannot be asked who may see a hit. That question goes back to
   * the database, through the very same code every other read path uses —
   * `DocumentsService.findVisibleByIds` wraps the private `accessContext()` that
   * phase 4 established as the one place visibility is decided. A hit the caller may
   * not see simply has no row come back, and drops out here.
   *
   * The engine's relevance order is then reapplied, because `id IN (...)` returns
   * rows in whatever order Postgres likes and ranking is the one thing the search
   * backend is actually for.
   */
  private async resolve(caller: SearchCaller, hits: SearchHit[]): Promise<SearchResult[]> {
    const documentIds = hits.filter((hit) => hit.type === 'document').map((hit) => hit.id);
    const employeeIds = hits.filter((hit) => hit.type === 'employee').map((hit) => hit.id);

    const [documents, employees] = await Promise.all([
      documentIds.length > 0
        ? this.documents.findVisibleByIds(
            { id: caller.id, organizationId: caller.organizationId, canManage: caller.permissions.includes('document:manage') },
            documentIds,
          )
        : Promise.resolve([]),
      employeeIds.length > 0
        ? this.users.findByIds(caller.organizationId, employeeIds)
        : Promise.resolve([]),
    ]);

    const byKey = new Map<string, SearchResult>();

    for (const document of documents) {
      byKey.set(`document-${document.id}`, {
        type: 'document',
        id: document.id,
        title: document.title,
        subtitle: document.category.getEntity().name,
        // The documents screen expands an inline detail panel rather than routing
        // to one — phase 4's decision, so the link opens the row in place.
        href: `/documents?open=${document.id}`,
      });
    }

    for (const employee of employees) {
      byKey.set(`employee-${employee.id}`, {
        type: 'employee',
        id: employee.id,
        title: fullName(employee),
        subtitle: employee.jobTitle,
        href: `/people/${employee.id}`,
      });
    }

    return hits
      .map((hit) => byKey.get(`${hit.type}-${hit.id}`))
      .filter((result): result is SearchResult => result !== undefined);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
