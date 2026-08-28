import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser, DocumentCategorySummary } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { DocumentsService } from './documents.service.js';
import { CreateDocumentCategoryDto } from './dto/create-document-category.dto.js';

/**
 * `GET` here is gated on `document:read`, not `organization:manage` — a deliberate
 * deviation from the roadmap's table, and the same correction phase 3 made for
 * `attendance:read`. The category chip row lives on the employee's own /documents
 * screen; gating its read behind an admin permission would ship that row broken for
 * everyone it exists for. Writing a category is still an organization setting.
 */
@Controller('document-categories')
export class DocumentSettingsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('document:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<DocumentCategorySummary[]> {
    return this.documents.listCategories(user.organizationId, includeInactive === 'true');
  }

  @Post()
  @RequirePermissions('organization:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentCategoryDto,
  ): Promise<DocumentCategorySummary> {
    return this.documents.createCategory(user.organizationId, dto);
  }

  /** Retiring rather than deleting — documents already filed under it keep naming it. */
  @Delete(':id')
  @RequirePermissions('organization:manage')
  retire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentCategorySummary> {
    return this.documents.retireCategory(user.organizationId, id);
  }
}
