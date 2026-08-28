import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Document } from '../documents/document.entity.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { User } from '../users/user.entity.js';
import { UsersModule } from '../users/users.module.js';
import { SearchController } from './search.controller.js';
import { SearchIndexer } from './search-indexer.service.js';
import { SearchQueryService } from './search-query.service.js';
import { SearchSubscriber } from './search.subscriber.js';

/**
 * The feature half of search. The seam it writes through is global
 * (`common/search`), which is what keeps this free of a cycle: `DocumentsModule`
 * knows nothing about this module, and this module imports it for the one thing only
 * it can answer — which documents a caller may see.
 */
@Module({
  imports: [MikroOrmModule.forFeature([Document, User]), DocumentsModule, UsersModule],
  controllers: [SearchController],
  providers: [SearchQueryService, SearchIndexer, SearchSubscriber],
})
export class SearchModule {}
