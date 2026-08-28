import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('never stores the plaintext', async () => {
    const hash = await passwords.hash('correct-horse-battery');

    expect(hash).not.toContain('correct-horse-battery');
    expect(hash.startsWith('$argon2')).toBe(true);
  });

  it('verifies the password it hashed', async () => {
    const hash = await passwords.hash('correct-horse-battery');

    await expect(passwords.verify(hash, 'correct-horse-battery')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'correct-horse-batteries')).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([
      passwords.hash('correct-horse-battery'),
      passwords.hash('correct-horse-battery'),
    ]);

    expect(first).not.toBe(second);
  });

  it('fails without throwing when the user has no password set', async () => {
    await expect(passwords.verify(null, 'anything')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed login, not an error', async () => {
    await expect(passwords.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
