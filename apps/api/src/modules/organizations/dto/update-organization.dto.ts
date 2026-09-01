import { IsIn, IsOptional, IsString, IsTimeZone, MaxLength, MinLength } from 'class-validator';
import { SUPPORTED_LOCALES, type LocaleCode, type UpdateOrganizationRequest } from '@beacon/shared';

/** The slug and id are never client-settable — they identify the tenant. */
export class UpdateOrganizationDto implements UpdateOrganizationRequest {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  /**
   * Only a language Beacon has copy for. Free text used to be accepted here, which
   * made a typo — or a plausible-looking `de-DE` — save cleanly and change nothing.
   */
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  defaultLocale?: LocaleCode;

  /** Only a zone `Intl` accepts — the same reason `defaultLocale` is not free text. */
  @IsOptional()
  @IsTimeZone()
  @MaxLength(64)
  timezone?: string;
}
