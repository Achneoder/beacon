import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { DecideCorrectionRequest } from '@beacon/shared';

export class DecideCorrectionDto implements DecideCorrectionRequest {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
