import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SecretCipher } from './secret-cipher.js';

const KEY = 'hEiGfrri2jTYh6jnzIq5xcwVDWn+jKw/o9jnwwZJfeI=';

function configFor(value: string | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService;
}

describe('SecretCipher', () => {
  it('reports unconfigured when no key is set', () => {
    const cipher = new SecretCipher(configFor(undefined));

    expect(cipher.isConfigured()).toBe(false);
  });

  it('refuses a key that does not decode to 32 bytes', () => {
    expect(() => new SecretCipher(configFor('dG9vLXNob3J0'))).toThrow(/32 bytes/);
  });

  it('round-trips a secret', () => {
    const cipher = new SecretCipher(configFor(KEY));

    const encrypted = cipher.encrypt('super-secret-client-secret');

    expect(encrypted.ciphertext).not.toContain('super-secret-client-secret');
    expect(cipher.decrypt(encrypted)).toBe('super-secret-client-secret');
  });

  it('produces a different iv and ciphertext on every call', () => {
    const cipher = new SecretCipher(configFor(KEY));

    const first = cipher.encrypt('same-plaintext');
    const second = cipher.encrypt('same-plaintext');

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects a tampered ciphertext', () => {
    const cipher = new SecretCipher(configFor(KEY));
    const encrypted = cipher.encrypt('super-secret-client-secret');

    const tampered = Buffer.from(encrypted.ciphertext, 'base64');
    tampered[0] ^= 0xff;

    expect(() =>
      cipher.decrypt({ ciphertext: tampered.toString('base64'), iv: encrypted.iv }),
    ).toThrow();
  });

  it('rejects a tampered iv', () => {
    const cipher = new SecretCipher(configFor(KEY));
    const encrypted = cipher.encrypt('super-secret-client-secret');

    const tampered = Buffer.from(encrypted.iv, 'base64');
    tampered[0] ^= 0xff;

    expect(() =>
      cipher.decrypt({ ciphertext: encrypted.ciphertext, iv: tampered.toString('base64') }),
    ).toThrow();
  });

  it('throws rather than silently encrypting when unconfigured', () => {
    const cipher = new SecretCipher(configFor(undefined));

    expect(() => cipher.encrypt('x')).toThrow('SSO_ENCRYPTION_KEY is not configured');
  });
});
