import { IsInt, IsISO8601, IsNumber, IsOptional, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * A quota is an employment term, so it is set rather than requested. The bounds are
 * generous on purpose — statutory minimums differ by country and Beacon does not
 * decide them.
 */
export class UpsertLeaveBalanceDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  entitlementDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  carryOverDays?: number;

  /** Null means the carry-over never expires. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  @MaxLength(10)
  carryOverExpiresOn?: string | null;
}
