import { BadRequestException, Controller, Get, Query, StreamableFile } from '@nestjs/common';
import {
  isBillableGroupBy,
  isReportGroupBy,
  type AbsenceSummary,
  type AttendanceSummary,
  type AuthenticatedUser,
  type BillableGroupBy,
  type BillableSummary,
  type ReportGroupBy,
} from '@beacon/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { optionalUuid } from '../../common/http/optional-uuid.pipe.js';
import { RequirePermissions } from '../../common/auth/permissions.decorator.js';
import { ReportsService, type Caller } from './reports.service.js';
import { attendanceCsvFilename, attendanceCsvStream } from './attendance-csv.js';

/** `YYYY-MM-DD`, the only date shape any Beacon query string carries. */
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The tenant comes from `@CurrentUser()` and never from the client.
 *
 * Every route is gated on `report:read` and none of them takes a `userId`: the
 * permission says *whether* the caller may see a report, and `ReportsService` decides
 * whose — themselves and their reports, or the organization once they hold
 * `attendance:approve`. That is the same narrowing attendance and absence already do,
 * so a manager's reach does not change with the screen they are on.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('attendance/summary')
  @RequirePermissions('report:read')
  attendanceSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ): Promise<AttendanceSummary> {
    return this.reports.attendanceSummary(callerOf(user), {
      from: toDate(from, 'from'),
      to: toDate(to, 'to'),
      groupBy: toGroupBy(groupBy),
    });
  }

  @Get('absences/summary')
  @RequirePermissions('report:read')
  absenceSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
  ): Promise<AbsenceSummary> {
    return this.reports.absenceSummary(callerOf(user), toYear(year));
  }

  @Get('time/summary')
  @RequirePermissions('report:read')
  billableSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('projectId', optionalUuid) projectId?: string,
  ): Promise<BillableSummary> {
    return this.reports.billableSummary(callerOf(user), {
      from: toDate(from, 'from'),
      to: toDate(to, 'to'),
      groupBy: toBillableGroupBy(groupBy),
      projectId,
    });
  }

  /**
   * The export. `format` exists so a later `xlsx` is a new value rather than a new
   * route, and anything but `csv` is refused rather than quietly served as one.
   *
   * The rows are streamed: a year across an organization is hundreds of thousands of
   * lines, and buffering the file to measure it would hold all of it in memory to feed
   * a socket that takes it a chunk at a time. No `Content-Length` for the same reason.
   */
  @Get('attendance/export')
  @RequirePermissions('report:read')
  async attendanceExport(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format = 'csv',
  ): Promise<StreamableFile> {
    if (format !== 'csv') throw new BadRequestException('only csv is supported');

    const { range, rows } = await this.reports.attendanceRows(callerOf(user), {
      from: toDate(from, 'from'),
      to: toDate(to, 'to'),
    });

    return new StreamableFile(attendanceCsvStream(rows), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${attendanceCsvFilename(range)}"`,
    });
  }
}

function callerOf(user: AuthenticatedUser): Caller {
  return {
    id: user.id,
    organizationId: user.organizationId,
    canApprove: user.permissions.includes('attendance:approve'),
  };
}

function toDate(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!LOCAL_DATE.test(value)) throw new BadRequestException(`${field} must be YYYY-MM-DD`);

  return value;
}

/** An unknown grouping is a client bug worth naming, not one to silently default. */
function toGroupBy(value?: string): ReportGroupBy | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isReportGroupBy(value)) throw new BadRequestException('groupBy must be user or department');

  return value;
}

/** An unknown grouping is a client bug worth naming, not one to silently default. */
function toBillableGroupBy(value?: string): BillableGroupBy | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isBillableGroupBy(value)) {
    throw new BadRequestException('groupBy must be project, task, client or user');
  }

  return value;
}

function toYear(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;

  const year = Number(value);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new BadRequestException('year must be a four-digit year');
  }

  return year;
}
