import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { UsersModule } from '../users/users.module.js';
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
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
