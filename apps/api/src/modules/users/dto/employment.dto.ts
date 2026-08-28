import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CONTRACT_TYPES,
  WORK_LOCATIONS,
  type ContractType,
  type EmploymentFields,
  type WorkLocation,
} from '@beacon/shared';

/**
 * Every employment field a manager may set, shared by create, update and invite.
 *
 * Each is nullable on purpose: `undefined` means "leave it alone", `null` means "clear
 * it". `@ValidateIf` on the nullable fields is what lets an explicit null through a
 * validator that would otherwise reject it.
 */
export class EmploymentDto implements EmploymentFields {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  employeeNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  jobTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  teamId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  managerId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(CONTRACT_TYPES)
  contractType?: ContractType | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  office?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(WORK_LOCATIONS)
  workLocation?: WorkLocation | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  /** A plain calendar date — an employment start has no time of day. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  startsOn?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  endsOn?: string | null;
}

/** Name and address, shared by created users and invitations alike. */
export class PersonDto extends EmploymentDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsUUID('4', { each: true })
  @Type(() => String)
  roleIds?: string[];
}
