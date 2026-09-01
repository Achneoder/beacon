import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Invitation } from '../invitations/invitation.entity.js';
import { User } from '../users/user.entity.js';
import { Role } from './role.entity.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([Role, User, Invitation])],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
