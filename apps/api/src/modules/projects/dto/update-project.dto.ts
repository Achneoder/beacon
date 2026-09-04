import { IsNumber, IsOptional, IsString, Min, MaxLength, ValidateIf } from 'class-validator';
import type { UpdateProjectRequest } from '@beacon/shared';

export class UpdateProjectDto implements UpdateProjectRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  clientName?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  hourlyRate?: number | null;
}
