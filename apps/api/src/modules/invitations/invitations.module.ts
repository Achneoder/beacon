import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AuthModule } from '../auth/auth.module.js';
import { Department } from '../departments/department.entity.js';
import { Role } from '../roles/role.entity.js';
import { Team } from '../teams/team.entity.js';
import { User } from '../users/user.entity.js';
import { Invitation } from './invitation.entity.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [AuthModule, MikroOrmModule.forFeature([Invitation, User, Role, Department, Team])],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  // `SsoModule` needs `acceptForFederatedEmail`; a provider is private to its module
  // unless exported.
  exports: [InvitationsService],
})
export class InvitationsModule {}
