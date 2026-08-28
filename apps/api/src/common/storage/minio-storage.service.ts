import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { StorageService, type StoredObject } from './storage.service.js';

/** Default implementation, backed by the MinIO service in infra/docker-compose.yml. */
@Injectable()
export class MinioStorageService extends StorageService implements OnModuleInit {
  private readonly client: Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.client = new Client({
      endPoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      port: Number(config.get('STORAGE_PORT') ?? 9000),
      useSSL: config.get('STORAGE_USE_SSL') === 'true',
      accessKey: config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('STORAGE_SECRET_KEY'),
    });
  }

  async onModuleInit(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    const result = await this.client.putObject(this.bucket, key, body, undefined, {
      'Content-Type': contentType,
    });
    const stat = await this.client.statObject(this.bucket, key, {
      versionId: result.versionId ?? undefined,
    });
    return { key, size: stat.size, contentType };
  }

  get(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  delete(key: string): Promise<void> {
    return this.client.removeObject(this.bucket, key);
  }

  signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expiresInSeconds);
  }
}
