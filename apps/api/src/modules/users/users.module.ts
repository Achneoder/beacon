import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Department } from '../departments/department.entity.js';
import { Role } from '../roles/role.entity.js';
import { Team } from '../teams/team.entity.js';
import { User } from './user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([User, Role, Department, Team])],
  controllers: [UsersController],
  providers: [UsersService],
  // Invitations create users, and phases 2 and 3 need subordinateIdsOf().
  exports: [UsersService],
})
export class UsersModule {}
