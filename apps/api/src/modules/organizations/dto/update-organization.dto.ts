import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateOrganizationRequest } from '@beacon/shared';

/** The slug and id are never client-settable — they identify the tenant. */
export class UpdateOrganizationDto implements UpdateOrganizationRequest {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
