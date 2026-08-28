import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import type { CreateDocumentRequest } from '@beacon/shared';

/**
 * Arrives as multipart text fields, so every value is a string on the wire — the
 * boolean needs `Transform` before `@IsBoolean` runs, and the file itself is a
 * separate `@UploadedFile()` parameter multer strips out of `req.body` before the
 * global `ValidationPipe`'s `forbidNonWhitelisted` ever sees it.
 */
export class CreateDocumentDto implements CreateDocumentRequest {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsUUID()
  categoryId!: string;

  /** Filing into someone else's record needs `document:manage`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  organizationWide?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  @MaxLength(10)
  retentionUntil?: string | null;
}
