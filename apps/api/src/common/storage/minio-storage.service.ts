import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { StorageService, type StoredObject } from './storage.service.js';

type StorageEncryption = 'none' | 'sse-s3';

const SSE_ALGORITHM = 'AES256';

function toEncryption(value: unknown): StorageEncryption {
  return value === 'sse-s3' ? 'sse-s3' : 'none';
}

/** Default implementation, backed by the MinIO service in infra/docker-compose.yml. */
@Injectable()
export class MinioStorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client: Client;
  private readonly bucket: string;
  private readonly encryption: StorageEncryption;

  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.encryption = toEncryption(config.get('STORAGE_ENCRYPTION'));
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

    if (this.encryption === 'sse-s3') await this.enableEncryption();
  }

  /**
   * `STORAGE_ENCRYPTION=sse-s3` is a request, not a fact — the dropzone must only
   * claim encryption once the bucket has proven it, which `enableEncryption` checks
   * once, at boot. Reporting the config value directly would let the UI promise
   * something a MinIO without a KMS silently never turned on.
   */
  encryptedAtRest(): boolean {
    return this.encryption === 'sse-s3';
  }

  /**
   * Applies SSE-S3 and reads it back rather than trusting the call succeeded — MinIO
   * accepts `setBucketEncryption` even where it cannot enforce it (no KMS configured),
   * so only the read-back is proof. Throwing here aborts `onModuleInit`, which aborts
   * Nest's boot: refusing to start beats claiming encryption that is not on.
   */
  private async enableEncryption(): Promise<void> {
    await this.client.setBucketEncryption(this.bucket, {
      Rule: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: SSE_ALGORITHM } }],
    });

    const config = (await this.client.getBucketEncryption(this.bucket)) as
      | { Rule?: Array<{ ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: string } }> }
      | undefined;
    const algorithm = config?.Rule?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;

    if (algorithm !== SSE_ALGORITHM) {
      throw new Error('storage encryption sse-s3 was requested but the bucket does not report it');
    }

    this.logger.log(`storage encryption sse-s3 confirmed on bucket ${this.bucket}`);
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    const metaData: Record<string, string> = { 'Content-Type': contentType };
    // Belt and braces alongside the bucket default: an object stays encrypted even if
    // the bucket policy is cleared later.
    if (this.encryption === 'sse-s3') metaData['X-Amz-Server-Side-Encryption'] = SSE_ALGORITHM;

    const result = await this.client.putObject(this.bucket, key, body, undefined, metaData);
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
