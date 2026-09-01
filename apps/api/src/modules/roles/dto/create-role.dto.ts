import { ArrayUnique, IsArray, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSIONS, type CreateRoleRequest, type Permission } from '@beacon/shared';

export class CreateRoleDto implements CreateRoleRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /**
   * Closed to `PERMISSIONS`, the same reason a locale is closed to `SUPPORTED_LOCALES`:
   * a permission nothing checks would save cleanly and grant nothing, and the role
   * would read as though it did. An empty list is allowed — a role that carries no
   * authority is a label, not a mistake.
   */
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: Permission[];
}
