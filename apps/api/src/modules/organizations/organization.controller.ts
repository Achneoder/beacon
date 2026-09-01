import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AuthenticatedUser, OrganizationSummary } from '@beacon/shared';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { OrganizationService, toOrganizationSummary } from './organization.service.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

/**
 * "current" always resolves to the organization on the access token. No route accepts an
 * organization id from the client — that is how tenant isolation is enforced in practice.
 */
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get('current')
  @RequirePermissions('organization:read')
  async current(@CurrentUser() user: AuthenticatedUser): Promise<OrganizationSummary> {
    return toOrganizationSummary(await this.organizations.findById(user.organizationId));
  }

  @Patch('current')
  @RequirePermissions('organization:manage')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() changes: UpdateOrganizationDto,
  ): Promise<OrganizationSummary> {
    return toOrganizationSummary(await this.organizations.update(user.organizationId, changes));
  }
}
