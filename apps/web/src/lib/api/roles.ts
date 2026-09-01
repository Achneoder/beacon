import type { CreateRoleRequest, RoleSummary, UpdateRoleRequest } from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * Roles, as the REST API exposes them. Reading needs `organization:read` — the people
 * screens and the document access panel both name roles — while every mutation needs
 * `organization:manage` and is re-judged against the caller's own permissions server
 * side, so nothing here decides anything.
 */
export function listRoles(): Promise<RoleSummary[]> {
	return api<RoleSummary[]>('/roles');
}

export function createRole(body: CreateRoleRequest): Promise<RoleSummary> {
	return apiSend<RoleSummary>('/roles', 'POST', body);
}

export function updateRole(id: string, body: UpdateRoleRequest): Promise<RoleSummary> {
	return apiSend<RoleSummary>(`/roles/${id}`, 'PATCH', body);
}

export function deleteRole(id: string): Promise<void> {
	return apiSend<void>(`/roles/${id}`, 'DELETE');
}
