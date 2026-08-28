import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeilisearchSearchService } from './meilisearch-search.service.js';
import { NoopSearchService } from './noop-search.service.js';
import { SearchService } from './search.service.js';

/**
 * `SEARCH_HOST` is what decides, exactly as `MAIL_HOST` decides for mail: configured,
 * documents and people are indexed and searchable; absent, `NoopSearchService` makes
 * every call inert and the web app hides the field. An installation without a search
 * container is a supported deployment, not a degraded one.
 *
 * Global, and deliberately free of feature imports. This directory knows nothing
 * about `Document` or `User` — that knowledge lives in `modules/search`, which
 * imports `DocumentsModule` and `UsersModule` and injects the seam from here.
 * Keeping the two apart is what stops that from being a cycle, and it is the same
 * split `common/storage` and `modules/documents` already have.
 */
@Global()
@Module({
  providers: [
    {
      provide: SearchService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('SEARCH_HOST')
          ? new MeilisearchSearchService(config)
          : new NoopSearchService(),
    },
  ],
  exports: [SearchService],
})
export class SearchModule {}
