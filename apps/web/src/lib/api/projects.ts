import type {
	CreateProjectRequest,
	CreateTaskRequest,
	ProjectDetail,
	ProjectSummary,
	TaskSummary,
	UpdateProjectRequest,
	UpdateTaskRequest
} from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * The project/task catalog — what time is booked against. Every shape comes from
 * `@beacon/shared`; the API is the only contract.
 */

export function listProjects(includeInactive = false): Promise<ProjectSummary[]> {
	return api<ProjectSummary[]>(`/projects${includeInactive ? '?includeInactive=true' : ''}`);
}

export function getProject(id: string, includeInactive = false): Promise<ProjectDetail> {
	return api<ProjectDetail>(`/projects/${id}${includeInactive ? '?includeInactive=true' : ''}`);
}

export function createProject(body: CreateProjectRequest): Promise<ProjectSummary> {
	return apiSend<ProjectSummary>('/projects', 'POST', body);
}

export function updateProject(id: string, body: UpdateProjectRequest): Promise<ProjectSummary> {
	return apiSend<ProjectSummary>(`/projects/${id}`, 'PATCH', body);
}

/** Retires rather than deletes — a past time entry must keep naming it. */
export function retireProject(id: string): Promise<ProjectSummary> {
	return apiSend<ProjectSummary>(`/projects/${id}`, 'DELETE');
}

export function createTask(projectId: string, body: CreateTaskRequest): Promise<TaskSummary> {
	return apiSend<TaskSummary>(`/projects/${projectId}/tasks`, 'POST', body);
}

export function updateTask(
	projectId: string,
	taskId: string,
	body: UpdateTaskRequest
): Promise<TaskSummary> {
	return apiSend<TaskSummary>(`/projects/${projectId}/tasks/${taskId}`, 'PATCH', body);
}

/** Retires rather than deletes — a past time entry must keep naming it. */
export function retireTask(projectId: string, taskId: string): Promise<TaskSummary> {
	return apiSend<TaskSummary>(`/projects/${projectId}/tasks/${taskId}`, 'DELETE');
}
