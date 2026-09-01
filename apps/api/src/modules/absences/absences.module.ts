import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { UsersModule } from '../users/users.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { OvertimeBalance } from '../attendance/overtime-balance.entity.js';
import { WorkSchedule } from '../attendance/work-schedule.entity.js';
import { AbsenceRequest } from './absence-request.entity.js';
import { AbsenceType } from './absence-type.entity.js';
import { Holiday } from './holiday.entity.js';
import { LeaveBalance } from './leave-balance.entity.js';
import { AbsencesController } from './absences.controller.js';
import { AbsenceSettingsController } from './absence-settings.controller.js';
import { AbsencesService } from './absences.service.js';

@Module({
  imports: [
    // The two attendance tables this module reads directly rather than through
    // `AttendanceService`, which imports it: what a day off was scheduled to be, and
    // the bank that time off in lieu is paid out of.
    MikroOrmModule.forFeature([
      AbsenceType,
      AbsenceRequest,
      LeaveBalance,
      Holiday,
      WorkSchedule,
      OvertimeBalance,
    ]),
    // For `subordinateIdsOf` — "the people I approve for" is read in one place.
    UsersModule,
    // For `findVisible` — a sick note's visibility is enforced in exactly one place.
    DocumentsModule,
  ],
  controllers: [AbsencesController, AbsenceSettingsController],
  providers: [AbsencesService],
  // Attendance reads `coverageOf` to tag and credit a timesheet day.
  exports: [AbsencesService],
})
export class AbsencesModule {}
