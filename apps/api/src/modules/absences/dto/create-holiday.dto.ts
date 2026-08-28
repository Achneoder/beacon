import { IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateHolidayDto {
  @IsISO8601({ strict: true })
  @MaxLength(10)
  date!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  /** A state or canton; null is the whole organization. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  region?: string | null;
}
