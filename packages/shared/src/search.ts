/**
 * Search across the things a person can already reach: documents and colleagues.
 *
 * The shapes here are deliberately thin. A result carries only what the popover
 * renders and where to go — never the underlying record, because the two types have
 * nothing in common beyond a title and a line under it, and because a search result
 * is not the place to hand out fields the caller would otherwise have to ask a
 * permissioned endpoint for.
 *
 * What is *not* in this file is the important part: nothing about who may see a
 * result. Visibility is resolved against the database on every query — see
 * `SearchQueryService` — so no permission fact ever reaches the search index, and a
 * stale index cannot widen what anybody can find.
 */

export const SEARCH_RESULT_TYPES = ['document', 'employee'] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

/** How many results one query returns, across all types. */
export const SEARCH_RESULT_LIMIT = 8;

/** Below this, the field does not query at all — one letter matches everything. */
export const SEARCH_MIN_TERM_LENGTH = 2;

export interface SearchResult {
  type: SearchResultType;
  id: string;
  /** The document's title, or the person's full name. */
  title: string;
  /** The category name, or the job title — the muted line under the title. */
  subtitle: string | null;
  /** Where the result lives. Both destinations are screens that already exist. */
  href: string;
}

export interface SearchResponse {
  /** In the engine's relevance order, already narrowed to what the caller may see. */
  results: SearchResult[];
  /**
   * Whether a search backend is actually configured. False when the installation runs
   * without one — `SEARCH_HOST` unset — so the UI can hide the field rather than offer
   * a box that will only ever come back empty.
   */
  available: boolean;
}

export function isSearchResultType(value: string): value is SearchResultType {
  return (SEARCH_RESULT_TYPES as readonly string[]).includes(value);
}
