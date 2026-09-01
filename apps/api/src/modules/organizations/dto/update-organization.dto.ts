import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
