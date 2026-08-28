import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing behind an injectable, so feature code never imports the vendor
 * library directly — the same rule the StorageService abstraction follows.
 */
@Injectable()
export class PasswordService {
  /**
   * A valid argon2id hash of a value nobody can supply. Verifying against it lets
   * "no such user" cost the same as "wrong password", so login cannot be timed to
   * enumerate accounts.
   */
  private dummyHash: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(storedHash: string | null, plain: string): Promise<boolean> {
    if (storedHash === null) {
      await this.burnTime(plain);
      return false;
    }

    try {
      return await verify(storedHash, plain);
    } catch {
      // A malformed or truncated hash is a failed login, not a server error.
      return false;
    }
  }

  private async burnTime(plain: string): Promise<void> {
    this.dummyHash ??= hash('beacon-timing-equalizer');
    await verify(await this.dummyHash, plain).catch(() => false);
  }
}
