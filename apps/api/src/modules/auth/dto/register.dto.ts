import {
  IsEmail,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RegisterOrganizationRequest } from '@beacon/shared';

/** Long enough to resist offline cracking without pushing users into a password manager. */
const MIN_PASSWORD_LENGTH = 12;

export class RegisterDto implements RegisterOrganizationRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  organizationName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lower-case and hyphenated' })
  @MaxLength(100)
  slug?: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  /** Seeds `Organization.timezone`; an IANA zone, as everywhere else. */
  @IsOptional()
  @IsTimeZone()
  @MaxLength(64)
  timezone?: string;
}
