import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import type { AuthenticatedUser, SsoSettings, SsoTestResult } from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { SsoService } from './sso.service.js';
import { TestSsoSettingsDto } from './dto/test-sso-settings.dto.js';
import { UpdateSsoSettingsDto } from './dto/update-sso-settings.dto.js';

/** Admin-only, always scoped to the caller's own organization — see `OrganizationController`. */
@Controller('sso/settings')
export class SsoSettingsController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  @RequirePermissions('organization:manage')
  getSettings(@CurrentUser() user: AuthenticatedUser): Promise<SsoSettings> {
    return this.sso.getSettings(user.organizationId);
  }

  @Put()
  @RequirePermissions('organization:manage')
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSsoSettingsDto,
  ): Promise<SsoSettings> {
    return this.sso.updateSettings(user.organizationId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('organization:manage')
  deleteSettings(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.sso.deleteSettings(user.organizationId);
  }

  @Post('test')
  @RequirePermissions('organization:manage')
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestSsoSettingsDto,
  ): Promise<SsoTestResult> {
    return this.sso.test(user.organizationId, dto);
  }
}
