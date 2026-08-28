import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { UsersModule } from '../users/users.module.js';
import { DocumentCategory } from './document-category.entity.js';
import { Document } from './document.entity.js';
import { DocumentVersion } from './document-version.entity.js';
import { DocumentAccess } from './document-access.entity.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentSettingsController } from './document-settings.controller.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([DocumentCategory, Document, DocumentVersion, DocumentAccess]),
    // For `findEntity` — a caller's department and roles are read fresh on every
    // request, since the access token carries only permissions.
    UsersModule,
  ],
  controllers: [DocumentsController, DocumentSettingsController],
  providers: [DocumentsService],
  // Absences reads `findVisible` here to enforce a sick note's visibility.
  exports: [DocumentsService],
})
export class DocumentsModule {}
