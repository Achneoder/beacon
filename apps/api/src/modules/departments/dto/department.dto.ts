import { IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateDepartmentRequest } from '@beacon/shared';

export class DepartmentDto implements CreateDepartmentRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
