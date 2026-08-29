import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { OidcClient } from './oidc-client.js';
import { SsoAuthController } from './sso-auth.controller.js';
import { SsoSettingsController } from './sso-settings.controller.js';
import { SsoService } from './sso.service.js';

/**
 * `CryptoModule` is `@Global` (registered once in `app.module.ts`, like `StorageModule`
 * and `SearchModule`) so `SsoService` injects `SecretCipher` without it being listed
 * here. `AuthService.startSessionFor` is what turns a resolved identity into a
 * session, and `InvitationsService.acceptForFederatedEmail` is what a pending
 * invitation becomes on first SSO login.
 */
@Module({
  imports: [AuthModule, OrganizationModule, InvitationsModule],
  controllers: [SsoAuthController, SsoSettingsController],
  providers: [SsoService, OidcClient],
})
export class SsoModule {}
