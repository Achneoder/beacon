import { IsIn, IsOptional } from 'class-validator';
import { USER_STATUSES, type UpdateUserRequest, type UserStatusValue } from '@beacon/shared';
import { EmploymentDto } from './employment.dto.js';

/** Email is not updatable here — it identifies the account within the tenant. */
export class UpdateUserDto extends EmploymentDto implements UpdateUserRequest {
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatusValue;
}
