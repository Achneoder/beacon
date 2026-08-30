import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organizations/organization.module.js';
import { InstanceController } from './instance.controller.js';

@Module({
  imports: [OrganizationModule],
  controllers: [InstanceController],
})
export class InstanceModule {}
