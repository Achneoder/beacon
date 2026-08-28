import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import type { SetUserRolesRequest } from '@beacon/shared';

export class SetRolesDto implements SetUserRolesRequest {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  roleIds!: string[];
}
