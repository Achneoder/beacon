import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { CorrectionKind, CreateCorrectionRequest } from '@beacon/shared';
import { CORRECTION_KINDS } from '@beacon/shared';

/**
 * A break is stated as a total rather than as clock times — nobody remembers when
 * last Tuesday's lunch began, and the approver only cares how long the day was.
 */
export class CreateCorrectionDto implements CreateCorrectionRequest {
  @IsIn(CORRECTION_KINDS)
  kind!: CorrectionKind;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  entryId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  startedAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  endedAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  breakMinutes?: number;

  /** Required: an approver deciding blind is the failure mode this prevents. */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
