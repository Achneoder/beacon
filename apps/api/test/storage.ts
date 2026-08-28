import { Client } from 'minio';

/**
 * Talks to the throwaway MinIO from `infra/docker-compose.e2e.yml` directly through
 * the `minio` SDK. `CLAUDE.md`'s "never import a vendor SDK from feature code" rule
 * governs code behind `StorageService`; a test verifying the storage seam itself has
 * to speak to the backend — the same exemption `mailpit.ts` takes for SMTP.
 */
function client(): Client {
  return new Client({
    endPoint: process.env.STORAGE_ENDPOINT ?? 'localhost',
    port: Number(process.env.STORAGE_PORT ?? 9000),
    useSSL: process.env.STORAGE_USE_SSL === 'true',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.STORAGE_SECRET_KEY ?? '',
  });
}

function bucket(): string {
  return process.env.STORAGE_BUCKET ?? '';
}

/**
 * The guard rail — the exact mirror of `assertThrowawayDatabase` in `instance.ts`.
 * `apps/api/vitest.config.e2e.ts` names the throwaway bucket `beacon-e2e`; a suite
 * that writes and deletes real objects has to see that shape before it touches
 * anything, or a stray `apps/api/.env` pointed at the dev bucket becomes silent data
 * loss the same way the database once was.
 */
function assertThrowawayBucket(): void {
  const name = bucket();

  if (!name.endsWith('-e2e')) {
    throw new Error(
      `refusing to reset "${name || '(unset STORAGE_BUCKET)'}": the e2e suite only runs against a bucket whose name ends in -e2e`,
    );
  }
}

/**
 * Removes every object the suite could have written, so one run's uploads are never
 * mistaken for another's. Call this alongside `resetInstance` in `beforeAll` — version
 * rows and the objects they point at must reset together, or a spec sees a row whose
 * bytes were wiped by a previous run, or an object with no row pointing at it.
 */
export async function resetBucket(): Promise<void> {
  assertThrowawayBucket();

  const c = client();
  const bucketName = bucket();
  // The bucket is created lazily by MinioStorageService.onModuleInit, so a fresh set
  // of containers — before the API has ever booted against them — has none yet.
  if (!(await c.bucketExists(bucketName))) return;

  const keys: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = c.listObjectsV2(bucketName, 'org/', true);
    stream.on('data', (item) => {
      if (item.name) keys.push(item.name);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  if (keys.length > 0) await c.removeObjects(bucketName, keys);
}

/** Whether an upload actually reached the bucket. */
export async function objectExists(key: string): Promise<boolean> {
  assertThrowawayBucket();

  try {
    await client().statObject(bucket(), key);
    return true;
  } catch {
    return false;
  }
}

/** Reads an object back, so a spec can prove the bytes it uploaded are the bytes a
 *  signed URL would serve. */
export async function readObject(key: string): Promise<Buffer> {
  assertThrowawayBucket();

  const stream = await client().getObject(bucket(), key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);

  return Buffer.concat(chunks);
}
