import { Injectable } from '@nestjs/common';
import { SearchService, type SearchHit } from './search.service.js';

/**
 * What runs when `SEARCH_HOST` is unset. Indexes nothing, finds nothing, and says so
 * through `available()` so the web app hides the field instead of offering a box that
 * never returns anything.
 *
 * The point is that an installation with no search container is a *supported*
 * deployment, not a broken one — the same way a deployment with no `MAIL_HOST` still
 * issues invitations and just logs the mail. Every other feature works untouched.
 */
@Injectable()
export class NoopSearchService extends SearchService {
  async index(): Promise<void> {}

  async remove(): Promise<void> {}

  async replaceAll(): Promise<void> {}

  async query(): Promise<SearchHit[]> {
    return [];
  }

  available(): boolean {
    return false;
  }
}
