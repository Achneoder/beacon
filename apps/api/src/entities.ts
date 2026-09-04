import { Organization } from './modules/organizations/organization.entity.js';
import { Role } from './modules/roles/role.entity.js';
import { Department } from './modules/departments/department.entity.js';
import { Team } from './modules/teams/team.entity.js';
import { User } from './modules/users/user.entity.js';
import { Invitation } from './modules/invitations/invitation.entity.js';
import { RefreshToken } from './modules/auth/refresh-token.entity.js';
import { AttendanceEntry } from './modules/attendance/attendance-entry.entity.js';
import { BreakEntry } from './modules/attendance/break-entry.entity.js';
import { AttendanceDay } from './modules/attendance/attendance-day.entity.js';
import { WorkSchedule } from './modules/attendance/work-schedule.entity.js';
import { OvertimeBalance } from './modules/attendance/overtime-balance.entity.js';
import { AttendanceCorrection } from './modules/attendance/attendance-correction.entity.js';
import { AbsenceType } from './modules/absences/absence-type.entity.js';
import { AbsenceRequest } from './modules/absences/absence-request.entity.js';
import { LeaveBalance } from './modules/absences/leave-balance.entity.js';
import { Holiday } from './modules/absences/holiday.entity.js';
import { DocumentCategory } from './modules/documents/document-category.entity.js';
import { Document } from './modules/documents/document.entity.js';
import { DocumentVersion } from './modules/documents/document-version.entity.js';
import { DocumentAccess } from './modules/documents/document-access.entity.js';
import { Project } from './modules/projects/project.entity.js';
import { Task } from './modules/projects/task.entity.js';
import { TimeEntry } from './modules/time-entries/time-entry.entity.js';
import { SsoProvider } from './modules/sso/sso-provider.entity.js';
import { SsoLoginAttempt } from './modules/sso/sso-login-attempt.entity.js';

/**
 * Explicit entity registry. MikroORM's glob-based discovery would need to require()
 * .ts sources, which breaks under ESM and Vitest — so every entity is listed here.
 * Add new entities to this array.
 */
export const ENTITIES = [
  Organization,
  Role,
  Department,
  Team,
  User,
  Invitation,
  RefreshToken,
  AttendanceEntry,
  BreakEntry,
  AttendanceDay,
  WorkSchedule,
  OvertimeBalance,
  AttendanceCorrection,
  AbsenceType,
  AbsenceRequest,
  LeaveBalance,
  Holiday,
  DocumentCategory,
  Document,
  DocumentVersion,
  DocumentAccess,
  Project,
  Task,
  TimeEntry,
  SsoProvider,
  SsoLoginAttempt,
];
