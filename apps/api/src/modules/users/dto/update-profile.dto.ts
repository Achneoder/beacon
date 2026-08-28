import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { UpdateOwnProfileRequest } from '@beacon/shared';

/**
 * Deliberately three fields. Everything else on the Profile screen is employment data,
 * which only `employee:manage` may change — a person cannot promote themselves by
 * editing their own job title.
 */
export class UpdateProfileDto implements UpdateOwnProfileRequest {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  timezone?: string | null;
}
