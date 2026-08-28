import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MinioStorageService } from './minio-storage.service.js';

const bucketExists = vi.fn();
const makeBucket = vi.fn();
const setBucketEncryption = vi.fn();
const getBucketEncryption = vi.fn();

vi.mock('minio', () => {
  class FakeClient {
    bucketExists = bucketExists;
    makeBucket = makeBucket;
    setBucketEncryption = setBucketEncryption;
    getBucketEncryption = getBucketEncryption;
  }

  return { Client: FakeClient };
});

function configFor(values: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    },
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const BASE_CONFIG = {
  STORAGE_BUCKET: 'beacon-test',
  STORAGE_ENDPOINT: 'localhost',
  STORAGE_ACCESS_KEY: 'beacon',
  STORAGE_SECRET_KEY: 'beacon-secret',
};

describe('MinioStorageService encryption', () => {
  beforeEach(() => {
    bucketExists.mockReset().mockResolvedValue(true);
    makeBucket.mockReset();
    setBucketEncryption.mockReset().mockResolvedValue(undefined);
    getBucketEncryption.mockReset();
  });

  it('never calls setBucketEncryption when STORAGE_ENCRYPTION is none', async () => {
    const service = new MinioStorageService(
      configFor({ ...BASE_CONFIG, STORAGE_ENCRYPTION: 'none' }),
    );

    await service.onModuleInit();

    expect(setBucketEncryption).not.toHaveBeenCalled();
    expect(service.encryptedAtRest()).toBe(false);
  });

  it('reports encryptedAtRest once the bucket confirms sse-s3', async () => {
    getBucketEncryption.mockResolvedValue({
      Rule: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
    });
    const service = new MinioStorageService(
      configFor({ ...BASE_CONFIG, STORAGE_ENCRYPTION: 'sse-s3' }),
    );

    await service.onModuleInit();

    expect(setBucketEncryption).toHaveBeenCalledOnce();
    expect(service.encryptedAtRest()).toBe(true);
  });

  it('refuses to finish booting when the backend does not report sse-s3', async () => {
    getBucketEncryption.mockResolvedValue({ Rule: [] });
    const service = new MinioStorageService(
      configFor({ ...BASE_CONFIG, STORAGE_ENCRYPTION: 'sse-s3' }),
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      'storage encryption sse-s3 was requested but the bucket does not report it',
    );
  });
});
