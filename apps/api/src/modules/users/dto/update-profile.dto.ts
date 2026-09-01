import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { SUPPORTED_LOCALES, type LocaleCode, type UpdateOwnProfileRequest } from '@beacon/shared';

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

  /** Null hands the person back to the organization's default language. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(SUPPORTED_LOCALES)
  locale?: LocaleCode | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  timezone?: string | null;
}
