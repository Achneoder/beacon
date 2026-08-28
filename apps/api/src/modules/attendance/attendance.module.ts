import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { UsersModule } from '../users/users.module.js';
import { AbsencesModule } from '../absences/absences.module.js';
import { AttendanceCorrection } from './attendance-correction.entity.js';
import { AttendanceDay } from './attendance-day.entity.js';
import { AttendanceEntry } from './attendance-entry.entity.js';
import { BreakEntry } from './break-entry.entity.js';
import { OvertimeBalance } from './overtime-balance.entity.js';
import { WorkSchedule } from './work-schedule.entity.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      AttendanceEntry,
      BreakEntry,
      AttendanceDay,
      WorkSchedule,
      OvertimeBalance,
      AttendanceCorrection,
    ]),
    // For `subordinateIdsOf` — "the people I approve for" is read in one place.
    UsersModule,
    // For `coverageOf` — a timesheet row's absence tag and its credited flag.
    AbsencesModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
