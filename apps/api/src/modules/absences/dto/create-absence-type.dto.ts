import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { AbsenceColorRole } from '@beacon/shared';
import { ABSENCE_COLOR_ROLES } from '@beacon/shared';

export class CreateAbsenceTypeDto {
  /** Stable across renames, so the seed and the tests can name a type. */
  @Matches(/^[a-z0-9-]{2,64}$/)
  key!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  deductsFromQuota?: boolean;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsBoolean()
  countsAsWork?: boolean;

  @IsOptional()
  @IsIn(ABSENCE_COLOR_ROLES)
  colorRole?: AbsenceColorRole;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;
}
