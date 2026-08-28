import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { CreateTeamRequest } from '@beacon/shared';

export class TeamDto implements CreateTeamRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Null for a cross-functional team that belongs to no single department. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  departmentId?: string | null;
}
