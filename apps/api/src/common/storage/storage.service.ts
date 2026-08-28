import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

/**
 * Every document/file operation goes through this interface so an organization can
 * substitute S3, GCS or its own storage for the bundled MinIO service. Feature code
 * injects `StorageService`, never a vendor client.
 */
export abstract class StorageService {
  abstract put(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<StoredObject>;
  abstract get(key: string): Promise<Readable>;
  abstract delete(key: string): Promise<void>;
  abstract signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  /** Whether `put` actually encrypts objects at rest — what the dropzone may claim. */
  abstract encryptedAtRest(): boolean;
}
