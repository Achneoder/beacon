import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { DecideAbsenceRequest } from '@beacon/shared';

export class DecideAbsenceDto implements DecideAbsenceRequest {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
