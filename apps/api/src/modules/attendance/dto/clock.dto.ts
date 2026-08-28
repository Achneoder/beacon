import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { AttendanceSource, ClockRequest } from '@beacon/shared';
import { ATTENDANCE_SOURCES } from '@beacon/shared';

export class ClockDto implements ClockRequest {
  /** The web app leaves this out; the desktop and mobile clients name themselves. */
  @IsOptional()
  @IsIn(ATTENDANCE_SOURCES)
  source?: AttendanceSource;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
