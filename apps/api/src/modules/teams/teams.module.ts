import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Department } from '../departments/department.entity.js';
import { User } from '../users/user.entity.js';
import { Team } from './team.entity.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([Team, Department, User])],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
