import type { SearchResponse, SearchResultType } from '@beacon/shared';
import { api } from './client';

/** The search half of the REST API. Every shape comes from `@beacon/shared`. */

export function search(term: string, types: SearchResultType[] = []): Promise<SearchResponse> {
	const params = new URLSearchParams({ q: term });
	if (types.length > 0) params.set('types', types.join(','));

	return api<SearchResponse>(`/search?${params.toString()}`);
}

/**
 * Rebuilds the index from the database. Only `organization:manage` may call it — the
 * index is derived state with no boot-time backfill, so this is the repair after a
 * fresh container or a restored volume.
 */
export function reindexSearch(): Promise<{ documents: number; employees: number }> {
	return api<{ documents: number; employees: number }>('/search/reindex', { method: 'POST' });
}
