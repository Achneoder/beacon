import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { SsoPublicState } from '@beacon/shared';
import { PASSWORD_THROTTLE } from '../../common/auth/throttle.js';
import { Public } from '../auth/public.decorator.js';
import { setRefreshCookie } from '../auth/refresh-cookie.js';
import { SsoService } from './sso.service.js';

/**
 * `/auth/sso*` — everything a browser touches before a session exists, so every route
 * here is `@Public()`. `/sso/settings*`, the admin side, lives in `SsoSettingsController`.
 */
@Controller('auth/sso')
export class SsoAuthController {
  constructor(
    private readonly sso: SsoService,
    private readonly config: ConfigService,
  ) {}

  /** What the login screen needs before anyone has signed in. */
  @Public()
  @Get()
  publicState(): Promise<SsoPublicState> {
    return this.sso.publicState();
  }

  /**
   * Returns a URL rather than a 302: the caller is `fetch` inside the SPA, which
   * cannot usefully follow a cross-origin redirect and needs to show a failure
   * inline. The SPA assigns `window.location` itself.
   */
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @Post('start')
  @HttpCode(HttpStatus.OK)
  start(@Req() request: Request): Promise<{ authorizationUrl: string }> {
    return this.sso.start(request.get('user-agent'));
  }

  /**
   * The IdP redirects the *browser* here — the API's origin, not the SPA's — so this
   * finishes by 302-ing back to the web app. No token ever travels in that redirect:
   * it carries only the `HttpOnly` refresh cookie (`SameSite=Lax`, path `/api/auth`,
   * so it survives the hop), and `session.bootstrap()` trades it for an access token
   * the same way it already does on every page load.
   */
  @Public()
  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const callbackUrl = new URL(
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    );
    const outcome = await this.sso.finish(callbackUrl, request.get('user-agent'));
    const target = this.webBaseUrl();

    if ('errorCode' in outcome) {
      response.redirect(`${target}/login?error=${outcome.errorCode}`);
      return;
    }

    setRefreshCookie(
      response,
      this.config,
      outcome.session.refreshToken,
      outcome.session.refreshMaxAgeMs,
    );
    response.redirect(target);
  }

  private webBaseUrl(): string {
    return (
      this.config.get<string>('WEB_BASE_URL') ??
      this.config.get<string>('CORS_ORIGIN') ??
      'http://localhost:5173'
    ).replace(/\/+$/, '');
  }
}
