import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsIssuerUrl } from './issuer-url.validator.js';

/**
 * What "Test connection" sends — the form's current values, so an admin can verify an
 * issuer before ever saving it. `clientSecret` is optional: re-testing after a save
 * falls back to the one already stored, the same way `UpdateSsoSettingsDto` does.
 */
export class TestSsoSettingsDto {
  @IsIssuerUrl()
  @MaxLength(2048)
  issuerUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  clientId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  clientSecret?: string;
}
