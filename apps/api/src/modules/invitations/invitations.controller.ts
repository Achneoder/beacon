import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { PASSWORD_THROTTLE } from '../../common/auth/throttle.js';
import type { Request, Response } from 'express';
import type {
  AuthResponse,
  AuthenticatedUser,
  CreatedInvitation,
  InvitationSummary,
} from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { AuthService } from '../auth/auth.service.js';
import { setRefreshCookie } from '../auth/refresh-cookie.js';
import { InvitationsService } from './invitations.service.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { AcceptInvitationDto } from './dto/accept-invitation.dto.js';

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @RequirePermissions('employee:manage')
  list(@CurrentUser() user: AuthenticatedUser): Promise<InvitationSummary[]> {
    return this.invitations.list(user.organizationId);
  }

  @Post()
  @RequirePermissions('employee:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(user.organizationId, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('employee:manage')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.invitations.revoke(user.organizationId, id);
  }

  /**
   * Public: the invitee has no account yet, so there is nothing to authenticate with —
   * the token in the body *is* the credential. Accepting signs them straight in, which
   * is what registration does and the only sensible end to the flow.
   */
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const user = await this.invitations.accept(dto);
    const session = await this.auth.startSessionFor(user, request.get('user-agent'));

    setRefreshCookie(response, this.config, session.refreshToken, session.refreshMaxAgeMs);

    return session.auth;
  }
}
