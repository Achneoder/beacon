import { IsNumber, IsOptional, IsString, Min, MaxLength, ValidateIf } from 'class-validator';
import type { CreateTaskRequest } from '@beacon/shared';

export class CreateTaskDto implements CreateTaskRequest {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  hourlyRate?: number | null;
}
