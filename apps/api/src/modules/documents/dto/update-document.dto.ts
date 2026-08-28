import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import type { UpdateDocumentRequest } from '@beacon/shared';

export class UpdateDocumentDto implements UpdateDocumentRequest {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  @MaxLength(10)
  retentionUntil?: string | null;
}
