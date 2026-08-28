import { IsString, MaxLength, MinLength } from 'class-validator';
import type { AcceptInvitationRequest } from '@beacon/shared';

/** Mirrors `RegisterDto`'s password rule — the same account gets the same floor. */
export class AcceptInvitationDto implements AcceptInvitationRequest {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
