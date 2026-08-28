import type { SearchResultType } from '@beacon/shared';

/**
 * One indexed thing. Deliberately free of anything about *who may see it*.
 *
 * Phase 4 settled that `DocumentsService.accessContext()` is the only code that
 * decides what a caller may read. Putting grant subjects, owner ids or department
 * ids in here would make the index a second such place, and an index is derived
 * state that can go stale — a revoked grant that had not yet been re-indexed would
 * keep a payslip findable. So the index answers "what matches these words", and the
 * database answers "and which of those may you see". See `SearchQueryService`.
 */
export interface SearchRecord {
  id: string;
  type: SearchResultType;
  organizationId: string;
  /** The document's title, or the person's full name. */
  title: string;
  /** Category name, or job title. */
  subtitle: string | null;
  /** Secondary text worth matching but not displaying — filename, email, employee number. */
  keywords: string[];
  /** Epoch milliseconds; breaks ties between equally relevant hits. */
  updatedAt: number;
}

/** What the engine gives back: identity only, never content. */
export interface SearchHit {
  id: string;
  type: SearchResultType;
}

export interface SearchQuery {
  organizationId: string;
  term: string;
  /** Which types the caller is allowed to search — resolved from their permissions. */
  types: SearchResultType[];
  limit: number;
}

/**
 * Search sits behind this interface for the same reason storage and mail do: an
 * organization that already runs Elasticsearch should be able to point Beacon at it
 * without a line of feature code changing. Feature code injects `SearchService`;
 * the `meilisearch` SDK never leaves `MeilisearchSearchService`.
 *
 * Every method takes an organization id, and every call to the backend carries it as
 * a filter. There is one organization per installation today, but nothing may read
 * across it — the same rule that governs every database query.
 */
export abstract class SearchService {
  /** Upserts. Callers must not depend on the records being queryable when this resolves. */
  abstract index(records: SearchRecord[]): Promise<void>;

  abstract remove(type: SearchResultType, organizationId: string, ids: string[]): Promise<void>;

  /**
   * Replaces everything an organization has of one type, and waits for the backend
   * to have applied it. Part of the seam rather than an implementation detail
   * because the index is *derived* state: a fresh container or a restored backup
   * leaves it empty, and every implementation therefore owes a way to rebuild.
   * Unlike `index`, this drops records whose rows are gone.
   */
  abstract replaceAll(
    type: SearchResultType,
    organizationId: string,
    records: SearchRecord[],
  ): Promise<void>;

  abstract query(query: SearchQuery): Promise<SearchHit[]>;

  /**
   * Whether a backend is actually configured — the same honesty
   * `StorageService.encryptedAtRest()` provides. The UI hides the search field
   * rather than offering a box that can only come back empty.
   */
  abstract available(): boolean;
}
