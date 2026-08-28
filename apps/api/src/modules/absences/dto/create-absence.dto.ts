import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { CreateAbsenceRequest } from '@beacon/shared';

/**
 * Dates, not instants: an absence has no time of day. `IsISO8601` with `strict`
 * would accept a full timestamp, so the shape is pinned to `YYYY-MM-DD` by the
 * matching pattern the entity's `date` column expects.
 */
export class CreateAbsenceDto implements CreateAbsenceRequest {
  @IsUUID()
  typeId!: string;

  @IsISO8601({ strict: true })
  @MaxLength(10)
  startsOn!: string;

  @IsISO8601({ strict: true })
  @MaxLength(10)
  endsOn!: string;

  @IsOptional()
  @IsBoolean()
  halfDayStart?: boolean;

  @IsOptional()
  @IsBoolean()
  halfDayEnd?: boolean;

  /** "Optional — visible to your manager." */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  /** Raising an absence for someone else needs `holiday:approve`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  userId?: string | null;
}
