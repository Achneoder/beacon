import { Global, Module } from '@nestjs/common';
import { SecretCipher } from './secret-cipher.js';

/** Global, like `StorageModule` and `SearchModule` — one cipher, injected wherever a secret is stored. */
@Global()
@Module({
  providers: [SecretCipher],
  exports: [SecretCipher],
})
export class CryptoModule {}
