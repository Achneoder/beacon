import { IsIn, IsOptional, IsString, IsTimeZone, MaxLength, ValidateIf } from 'class-validator';
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

  /**
   * An IANA zone `Intl` will actually accept. Null hands the person back to the
   * organization's. Free text used to be taken here, so `Europe/Berlon` saved
   * cleanly and then quietly put every clock-in on the wrong clock.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsTimeZone()
  @MaxLength(64)
  timezone?: string | null;
}
