import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { UsersModule } from '../users/users.module.js';
import { AbsenceRequest } from './absence-request.entity.js';
import { AbsenceType } from './absence-type.entity.js';
import { Holiday } from './holiday.entity.js';
import { LeaveBalance } from './leave-balance.entity.js';
import { AbsencesController } from './absences.controller.js';
import { AbsenceSettingsController } from './absence-settings.controller.js';
import { AbsencesService } from './absences.service.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([AbsenceType, AbsenceRequest, LeaveBalance, Holiday]),
    // For `subordinateIdsOf` — "the people I approve for" is read in one place.
    UsersModule,
  ],
  controllers: [AbsencesController, AbsenceSettingsController],
  providers: [AbsencesService],
  // Attendance reads `coverageOf` to tag and credit a timesheet day.
  exports: [AbsencesService],
})
export class AbsencesModule {}
