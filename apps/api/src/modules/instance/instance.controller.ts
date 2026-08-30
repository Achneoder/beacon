import { Controller, Get } from '@nestjs/common';
import { BEACON_PRODUCT, INSTANCE_API_VERSION, type InstanceInfo } from '@beacon/shared';
import { Public } from '../auth/public.decorator.js';
import { OrganizationService } from '../organizations/organization.service.js';

/**
 * What a client checks before it commits to a server address. The desktop connect
 * screen — and the mobile client that will follow it — probes candidate addresses
 * derived from whatever a user typed or an administrator provisioned, and only
 * persists one that answers here as `product: 'beacon'`.
 *
 * Deliberately says nothing about *who* runs this installation: anyone who can reach
 * the host learns that it is Beacon and whether it still needs installing, never the
 * organization's name. `GET /api/auth/setup` (`SetupState`) stays the web login
 * screen's own contract; this mirrors its `setupRequired` field rather than extending
 * it, so a field added for the login screen never silently appears on this one.
 */
@Public()
@Controller('instance')
export class InstanceController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get()
  async info(): Promise<InstanceInfo> {
    return {
      product: BEACON_PRODUCT,
      apiVersion: INSTANCE_API_VERSION,
      setupRequired: await this.organizations.isSetupRequired(),
    };
  }
}
