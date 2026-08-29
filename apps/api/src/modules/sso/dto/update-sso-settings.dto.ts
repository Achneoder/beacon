import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UpdateSsoSettingsRequest } from '@beacon/shared';
import { IsIssuerUrl } from './issuer-url.validator.js';

/**
 * `clientSecret` is optional so a settings save that only flips a switch does not have
 * to resend it — `SsoService` leaves the stored ciphertext alone when it is absent.
 * `issuerUrl` requires https: an OIDC discovery document and its tokens are bearer
 * credentials, and this is the one place a plain-http issuer would otherwise slip in.
 */
export class UpdateSsoSettingsDto implements UpdateSsoSettingsRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  scopes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emailClaim?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  enforced!: boolean;
}
