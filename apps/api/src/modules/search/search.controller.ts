import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  isSearchResultType,
  type AuthenticatedUser,
  type SearchResponse,
  type SearchResultType,
} from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { SearchIndexer } from './search-indexer.service.js';
import { SearchQueryService } from './search-query.service.js';

/**
 * The tenant comes from `@CurrentUser()`, never the query string — the same rule as
 * every other controller.
 *
 * `GET /search` declares no permission on purpose. It spans two features, and the
 * service narrows to whichever of them the caller holds: someone with `employee:read`
 * and no `document:read` gets colleagues and no documents, rather than a 403 for the
 * half they were never asking about.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchQueryService,
    private readonly indexer: SearchIndexer,
  ) {}

  @Get()
  query(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') term = '',
    @Query('types') types?: string,
  ): Promise<SearchResponse> {
    return this.search.query(user, term, parseTypes(types));
  }

  /**
   * Rebuilds this organization from the database. The index is derived state with no
   * boot-time backfill — a fresh container or a restored volume leaves search
   * silently empty — so this is the repair, and it is an organization setting rather
   * than something search itself decides to do.
   */
  @Post('reindex')
  @RequirePermissions('organization:manage')
  @HttpCode(HttpStatus.OK)
  reindex(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ documents: number; employees: number }> {
    return this.indexer.reindex(user.organizationId);
  }
}

/** `?types=document,employee`. Unknown values are dropped rather than refused —
 *  a stale client asking for a type this build does not have should get results,
 *  not a 400. */
function parseTypes(raw?: string): SearchResultType[] {
  if (!raw) return [];

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(isSearchResultType);
}
