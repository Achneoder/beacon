import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Organization } from './organization.entity.js';
import { Role } from '../roles/role.entity.js';
import { User } from '../users/user.entity.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([Organization, Role, User])],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
