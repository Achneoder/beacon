import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { UpdateTimeEntryRequest } from '@beacon/shared';

export class UpdateTimeEntryDto implements UpdateTimeEntryRequest {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  taskId?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'localDate must be a YYYY-MM-DD date' })
  localDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startedAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endedAt?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  durationMinutes?: number;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
