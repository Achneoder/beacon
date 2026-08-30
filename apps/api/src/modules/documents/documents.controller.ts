import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import {
  MAX_DOCUMENT_BYTES,
  type AuthenticatedUser,
  type DocumentAccessSummary,
  type DocumentDetail,
  type DocumentDownload,
  type DocumentSummary,
  type DocumentUploadPolicy,
  type DocumentVersionSummary,
} from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { optionalUuid } from '../../common/http/optional-uuid.pipe.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { DocumentsService, type DocumentCaller } from './documents.service.js';
import { DocumentFilePipe, type UploadedDocumentFile } from './document-file.pipe.js';
import { MulterExceptionFilter } from './multer-exception.filter.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { GrantDocumentAccessDto } from './dto/grant-document-access.dto.js';

/** `fields` is generous headroom for `CreateDocumentDto`'s five multipart fields. */
const UPLOAD_OPTIONS = {
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 12 },
};

/**
 * The tenant comes from `@CurrentUser()` and never from the client. `document:manage`
 * is what widens a caller past their own record and organization-wide documents — the
 * permission says *whether* they may look widely, `DocumentsService` decides *whose*.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('document:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoryId', optionalUuid) categoryId?: string,
    @Query('userId', optionalUuid) userId?: string,
  ): Promise<DocumentSummary[]> {
    return this.documents.list(callerOf(user), { categoryId, userId });
  }

  /** Declared before `:id` — a literal path segment must win over the param route. */
  @Get('upload-policy')
  @RequirePermissions('document:read')
  uploadPolicy(): DocumentUploadPolicy {
    return this.documents.uploadPolicy();
  }

  @Get(':id')
  @RequirePermissions('document:read')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentDetail> {
    return this.documents.get(callerOf(user), id);
  }

  @Get(':id/versions')
  @RequirePermissions('document:read')
  versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentVersionSummary[]> {
    return this.documents.listVersions(callerOf(user), id);
  }

  /** A short-lived signed URL, never proxied bytes. */
  @Get(':id/download')
  @RequirePermissions('document:read')
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versionId', optionalUuid) versionId?: string,
  ): Promise<DocumentDownload> {
    return this.documents.download(callerOf(user), id, versionId);
  }

  @Post()
  @RequirePermissions('document:write')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentDto,
    @UploadedFile(DocumentFilePipe) file: UploadedDocumentFile,
  ): Promise<DocumentSummary> {
    return this.documents.create(callerOf(user), dto, file);
  }

  @Post(':id/versions')
  @RequirePermissions('document:write')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  addVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(DocumentFilePipe) file: UploadedDocumentFile,
  ): Promise<DocumentVersionSummary> {
    return this.documents.addVersion(callerOf(user), id, file);
  }

  @Patch(':id')
  @RequirePermissions('document:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentSummary> {
    return this.documents.update(callerOf(user), id, dto);
  }

  /** Soft delete — refused while a retention date is still in the future. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('document:manage')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.documents.remove(callerOf(user), id);
  }

  @Post(':id/access')
  @RequirePermissions('document:manage')
  grantAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantDocumentAccessDto,
  ): Promise<DocumentAccessSummary> {
    return this.documents.grantAccess(callerOf(user), id, dto);
  }

  @Delete(':id/access/:accessId')
  @HttpCode(204)
  @RequirePermissions('document:manage')
  revokeAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('accessId', ParseUUIDPipe) accessId: string,
  ): Promise<void> {
    return this.documents.revokeAccess(callerOf(user), id, accessId);
  }
}

export function callerOf(user: AuthenticatedUser): DocumentCaller {
  return {
    id: user.id,
    organizationId: user.organizationId,
    canManage: user.permissions.includes('document:manage'),
  };
}
