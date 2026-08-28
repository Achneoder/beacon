import { Global, Module } from '@nestjs/common';
import { MinioStorageService } from './minio-storage.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: MinioStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
