import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Meilisearch, type Index } from 'meilisearch';
import type { SearchResultType } from '@beacon/shared';
import {
  SearchService,
  type SearchHit,
  type SearchQuery,
  type SearchRecord,
} from './search.service.js';

/**
 * What actually lands in the index. `ref` is the engine's primary key — a search
 * index is flat, so the compound identity of "a document with this uuid" has to be
 * folded into one field. Meilisearch allows `a-zA-Z0-9-_` there, which a uuid and a
 * hyphen both satisfy.
 */
type IndexedRecord = {
  ref: string;
  id: string;
  type: SearchResultType;
  organizationId: string;
  title: string;
  subtitle: string | null;
  keywords: string[];
  updatedAt: number;
};

function refOf(type: SearchResultType, id: string): string {
  return `${type}-${id}`;
}

/**
 * Meilisearch's filter syntax. Values are quoted rather than interpolated bare —
 * an organization id is a uuid today, but a filter expression is still a language
 * and nothing untrusted should be able to change its shape.
 */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * The bundled default, backed by the `meilisearch` service in
 * `infra/docker-compose.yml`. The SDK stays inside this file — feature code injects
 * `SearchService`, exactly as it injects `StorageService` rather than `minio`.
 */
@Injectable()
export class MeilisearchSearchService extends SearchService implements OnModuleInit {
  private readonly logger = new Logger(MeilisearchSearchService.name);
  private readonly client: Meilisearch;
  private readonly indexUid: string;

  constructor(config: ConfigService) {
    super();
    this.indexUid = config.get<string>('SEARCH_INDEX') ?? 'beacon';

    const host = config.getOrThrow<string>('SEARCH_HOST');
    const port = config.get<string>('SEARCH_PORT') ?? '7700';
    const useSsl = config.get('SEARCH_USE_SSL') === 'true';
    // A host given as a full URL wins as-is; otherwise it is host + port, matching
    // how STORAGE_ENDPOINT/STORAGE_PORT are configured.
    const url = /^https?:\/\//.test(host)
      ? host
      : `${useSsl ? 'https' : 'http'}://${host}:${port}`;

    this.client = new Meilisearch({ host: url, apiKey: config.get<string>('SEARCH_API_KEY') });
  }

  /**
   * Creates the index and pins its settings, the same create-if-absent shape
   * `MinioStorageService.onModuleInit` uses for its bucket. Unlike the bucket, a
   * failure here is *not* fatal: search is an enhancement, and an installation
   * whose search container is briefly down should still serve attendance, absence
   * and documents. `index()` and `query()` degrade on their own.
   */
  async onModuleInit(): Promise<void> {
    try {
      try {
        await this.client.getRawIndex(this.indexUid);
      } catch {
        await this.client.createIndex(this.indexUid, { primaryKey: 'ref' }).waitTask();
      }

      await this.index_()
        .updateSettings({
          searchableAttributes: ['title', 'subtitle', 'keywords'],
          // No permission fact is filterable because none is indexed — see
          // `SearchRecord`. `ref` is here so a delete can still be scoped by
          // organization rather than trusting the key alone.
          filterableAttributes: ['organizationId', 'type', 'ref'],
          sortableAttributes: ['updatedAt'],
        })
        .waitTask();
    } catch (error) {
      // Not fatal, unlike MinioStorageService refusing to boot without its bucket.
      // Documents, attendance and absence do not need search to work, and an
      // installation should not lose its whole API because one container is slow to
      // come up. `POST /search/reindex` is the way back once it has.
      this.logger.error(`could not prepare the search index: ${describe(error)}`);
    }
  }

  private index_(): Index<IndexedRecord> {
    return this.client.index<IndexedRecord>(this.indexUid);
  }

  available(): boolean {
    return true;
  }

  /**
   * Enqueues and returns; the write is not awaited to completion. Callers are
   * fire-and-forget (see `SearchSubscriber`), so a slow engine must not become a
   * slow upload. `reindex` awaits instead, because a caller who asked for a rebuild
   * is entitled to know it finished.
   */
  async index(records: SearchRecord[]): Promise<void> {
    if (records.length === 0) return;

    await this.index_().addDocuments(records.map(toIndexed));
  }

  async remove(type: SearchResultType, organizationId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    // Deleted by primary key, but the organization is still checked: the ref is
    // built from ids the caller supplied, and a delete that could reach across
    // tenants is exactly the shape of bug the scoping rule exists to prevent.
    const refs = ids.map((id) => refOf(type, id));
    await this.index_().deleteDocuments({
      filter: `organizationId = ${quote(organizationId)} AND ref IN [${refs.map(quote).join(', ')}]`,
    });
  }

  async query({ organizationId, term, types, limit }: SearchQuery): Promise<SearchHit[]> {
    if (types.length === 0) return [];

    const filter = [
      `organizationId = ${quote(organizationId)}`,
      `type IN [${types.map(quote).join(', ')}]`,
    ].join(' AND ');

    const response = await this.index_().search(term, { filter, limit, attributesToRetrieve: ['id', 'type'] });

    return response.hits.map((hit) => ({ id: hit.id, type: hit.type }));
  }

  /**
   * Deleting by filter first is what makes this a *rebuild* rather than an upsert:
   * a record whose row is gone from Postgres has nothing to overwrite it, and would
   * survive a pure `addDocuments` forever.
   */
  async replaceAll(
    type: SearchResultType,
    organizationId: string,
    records: SearchRecord[],
  ): Promise<void> {
    await this.index_()
      .deleteDocuments({
        filter: `organizationId = ${quote(organizationId)} AND type = ${quote(type)}`,
      })
      .waitTask();

    if (records.length === 0) return;

    await this.index_().addDocuments(records.map(toIndexed)).waitTask();
  }
}

function toIndexed(record: SearchRecord): IndexedRecord {
  return { ref: refOf(record.type, record.id), ...record };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
