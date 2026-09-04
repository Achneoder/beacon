import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ProjectsModule } from '../projects/projects.module.js';
import { TimeEntry } from './time-entry.entity.js';
import { TimeEntriesController } from './time-entries.controller.js';
import { TimeEntriesService } from './time-entries.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([TimeEntry]), ProjectsModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
})
export class TimeEntriesModule {}
