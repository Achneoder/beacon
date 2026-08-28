import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { CreateDocumentCategoryRequest } from '@beacon/shared';

export class CreateDocumentCategoryDto implements CreateDocumentCategoryRequest {
  /** Stable across renames, so the seed and the tests can name a category. */
  @Matches(/^[a-z0-9-]{2,64}$/)
  key!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;
}
