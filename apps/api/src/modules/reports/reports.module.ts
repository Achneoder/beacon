import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AttendanceEntry } from '../attendance/attendance-entry.entity.js';
import { OvertimeBalance } from '../attendance/overtime-balance.entity.js';
import { WorkSchedule } from '../attendance/work-schedule.entity.js';
import { AbsencesModule } from '../absences/absences.module.js';
import { UsersModule } from '../users/users.module.js';
import { User } from '../users/user.entity.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * The only module that reads across people, and the first consumer of `report:read`.
 *
 * It owns no entity: every figure is recomputed from attendance, schedules and leave
 * balances, so there is nothing here to migrate and nothing that can drift out of step
 * with the screens the numbers came from. It imports the two feature modules for the
 * decisions only they can make — `subordinateIdsOf` for whose numbers a caller may
 * see, `coverageOfMany` and `balancesFor` for what an absence did to a day and to a
 * quota — and reads the attendance tables directly for the raw entries.
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([AttendanceEntry, WorkSchedule, OvertimeBalance, User]),
    UsersModule,
    AbsencesModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
