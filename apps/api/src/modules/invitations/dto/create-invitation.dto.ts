import type { CreateInvitationRequest } from '@beacon/shared';
import { PersonDto } from '../../users/dto/employment.dto.js';

/** Same employment fields as creating a user — the invitee arrives fully filed. */
export class CreateInvitationDto extends PersonDto implements CreateInvitationRequest {}
