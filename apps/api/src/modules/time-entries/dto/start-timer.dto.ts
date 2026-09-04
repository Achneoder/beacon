import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import type { StartTimerRequest } from '@beacon/shared';

export class StartTimerDto implements StartTimerRequest {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  taskId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
