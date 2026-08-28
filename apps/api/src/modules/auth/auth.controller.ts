import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthResponse, AuthenticatedUser, SessionUser } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { Public } from './public.decorator.js';
import { clearRefreshCookie, cookieName, setRefreshCookie } from './refresh-cookie.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

/** Password endpoints are the obvious brute-force target, so they are rate-limited hard. */
const PASSWORD_THROTTLE = { auth: { ttl: 60_000, limit: 10 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respond(response, await this.auth.register(dto, request.get('user-agent')));
  }

  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respond(response, await this.auth.login(dto, request.get('user-agent')));
  }

  /**
   * Public because the access token it replaces has already expired — the httpOnly
   * refresh cookie is the credential here.
   */
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const token = this.readCookie(request);

    return this.respond(response, await this.auth.refresh(token, request.get('user-agent')));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.readCookie(request));
    clearRefreshCookie(response, this.config);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<SessionUser> {
    return this.auth.currentUser(user.id, user.organizationId);
  }

  private readCookie(request: Request): string | undefined {
    return (request.cookies as Record<string, string> | undefined)?.[cookieName(this.config)];
  }

  private respond(response: Response, session: IssuedSession): AuthResponse {
    setRefreshCookie(response, this.config, session.refreshToken, session.refreshMaxAgeMs);

    return session.auth;
  }
}
