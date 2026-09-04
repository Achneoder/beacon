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
import type { CreateManualTimeEntryRequest } from '@beacon/shared';

/**
 * Exactly one of `durationMinutes` or the `startedAt`/`endedAt` pair is required —
 * `@ValidateIf` here only rules out sending a range field alongside a duration (or vice
 * versa); the "at least one" half of the rule needs the whole body, which is why
 * `TimeEntriesService.resolveManualDuration` is the one place it is actually enforced.
 */
export class CreateManualTimeEntryDto implements CreateManualTimeEntryRequest {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  taskId?: string | null;

  @IsISO8601({ strict: true }, { message: 'localDate must be a YYYY-MM-DD date' })
  localDate!: string;

  @IsOptional()
  @ValidateIf((o) => o.durationMinutes === undefined)
  @IsISO8601({ strict: true })
  startedAt?: string;

  @IsOptional()
  @ValidateIf((o) => o.durationMinutes === undefined)
  @IsISO8601({ strict: true })
  endedAt?: string;

  @IsOptional()
  @ValidateIf((o) => o.startedAt === undefined && o.endedAt === undefined)
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
