import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { AttendanceSource, ClockOutRequest, ClockRequest } from '@beacon/shared';
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

export class ClockOutDto implements ClockOutRequest {
  /**
   * Only the desktop client sends this, replaying a standby it could not report in
   * time. `strict` so a bare `2026-08-29` cannot pass for an instant — the service
   * would read it as midnight UTC and silently discard a day's work.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  at?: string;
}
