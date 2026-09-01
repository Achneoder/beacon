import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSIONS, type Permission, type UpdateRoleRequest } from '@beacon/shared';

/** A partial edit: whichever half is present is replaced wholesale. */
export class UpdateRoleDto implements UpdateRoleRequest {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions?: Permission[];
}
