import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedSecret {
  /** The ciphertext with the GCM auth tag appended, base64-encoded. */
  ciphertext: string;
  iv: string;
}

/**
 * Encrypts bearer credentials at rest — today, an SSO provider's OIDC client secret.
 * Unlike `User.passwordHash`, a client secret has to be recoverable: Beacon presents
 * it back to the IdP on every token exchange, so it cannot be a one-way hash.
 *
 * `SSO_ENCRYPTION_KEY` is optional, the same way `MAIL_HOST` and `SEARCH_HOST` are —
 * an installation that never sets it simply cannot configure SSO, rather than failing
 * to boot. `isConfigured()` is what callers check before offering the feature.
 */
@Injectable()
export class SecretCipher {
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('SSO_ENCRYPTION_KEY');
    if (!raw) {
      this.key = null;
      return;
    }

    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      // A wrong-length key would silently encrypt with the wrong strength (or throw
      // node's own opaque error at the first real use) — refusing to boot beats
      // discovering that the first time an admin saves a client secret.
      throw new Error(
        `SSO_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
      );
    }

    this.key = key;
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): EncryptedSecret {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  /** Throws if the ciphertext, iv or tag were tampered with — GCM authenticates all three. */
  decrypt(secret: EncryptedSecret): string {
    const key = this.requireKey();
    const combined = Buffer.from(secret.ciphertext, 'base64');
    const tag = combined.subarray(combined.length - TAG_BYTES);
    const encrypted = combined.subarray(0, combined.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('SSO_ENCRYPTION_KEY is not configured');

    return this.key;
  }
}
