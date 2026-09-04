import { IsNumber, IsOptional, IsString, Min, MaxLength, ValidateIf } from 'class-validator';
import type { UpdateTaskRequest } from '@beacon/shared';

export class UpdateTaskDto implements UpdateTaskRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  hourlyRate?: number | null;
}
