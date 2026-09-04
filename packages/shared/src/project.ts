/**
 * The catalog time is booked against: a project, optionally broken into tasks, with an
 * optional client tag and an hourly rate.
 *
 * `clientName` is deliberately free text rather than a relation — there is no `Client`
 * entity in this phase. A task's rate overrides its project's when set; `effectiveHourlyRate`
 * is the one place that resolution happens, so the API (freezing a `TimeEntry`'s rate) and
 * the web (previewing one before it is booked) can never disagree on which rate applies.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  /** A free-text tag, not a relation. `null` when the project has no client. */
  clientName: string | null;
  description: string | null;
  /** `null` means "not billable by default" — a task may still set its own. */
  hourlyRate: number | null;
  /** Retired rather than deleted: a past `TimeEntry` must keep naming it. */
  active: boolean;
  taskCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  tasks: TaskSummary[];
}

export interface TaskSummary {
  id: string;
  projectId: string;
  name: string;
  /** Overrides `Project.hourlyRate` when set. See {@link effectiveHourlyRate}. */
  hourlyRate: number | null;
  active: boolean;
}

export interface CreateProjectRequest {
  name: string;
  clientName?: string | null;
  description?: string | null;
  hourlyRate?: number | null;
}

export interface UpdateProjectRequest {
  name?: string;
  clientName?: string | null;
  description?: string | null;
  hourlyRate?: number | null;
}

export interface CreateTaskRequest {
  name: string;
  hourlyRate?: number | null;
}

export interface UpdateTaskRequest {
  name?: string;
  hourlyRate?: number | null;
}

/** The rate that actually applies to a booking — a task's own rate wins when set. */
export function effectiveHourlyRate(
  project: { hourlyRate: number | null },
  task: { hourlyRate: number | null } | null | undefined,
): number | null {
  return task?.hourlyRate ?? project.hourlyRate;
}
