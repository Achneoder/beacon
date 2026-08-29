import type {
	CreateDepartmentRequest,
	CreateInvitationRequest,
	CreateTeamRequest,
	CreatedInvitation,
	DepartmentSummary,
	InvitationSummary,
	SetUserRolesRequest,
	TeamSummary,
	UpdateOwnProfileRequest,
	UpdateUserRequest,
	UserDetail,
	UserStatusValue,
	UserSummary
} from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * The people half of the REST API. Every shape here comes from `@beacon/shared` — the
 * API is the only contract, so nothing is redeclared.
 */

export interface PeopleFilter {
	departmentId?: string;
	teamId?: string;
	search?: string;
	status?: UserStatusValue;
}

function query(filter: PeopleFilter): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filter)) {
		if (value) params.set(key, value);
	}
	const search = params.toString();

	return search ? `?${search}` : '';
}

export function listPeople(filter: PeopleFilter = {}): Promise<UserSummary[]> {
	return api<UserSummary[]>(`/users${query(filter)}`);
}

export function getPerson(id: string): Promise<UserDetail> {
	return api<UserDetail>(`/users/${id}`);
}

export function getOwnProfile(): Promise<UserDetail> {
	return api<UserDetail>('/users/me');
}

export function updateOwnProfile(changes: UpdateOwnProfileRequest): Promise<UserDetail> {
	return apiSend<UserDetail>('/users/me', 'PATCH', changes);
}

export function updatePerson(id: string, changes: UpdateUserRequest): Promise<UserDetail> {
	return apiSend<UserDetail>(`/users/${id}`, 'PATCH', changes);
}

export function setPersonRoles(id: string, roleIds: string[]): Promise<UserDetail> {
	return apiSend<UserDetail>(`/users/${id}/roles`, 'POST', {
		roleIds
	} satisfies SetUserRolesRequest);
}

/** Soft delete — the account is disabled, so its history keeps its author. */
export function disablePerson(id: string): Promise<UserDetail> {
	return apiSend<UserDetail>(`/users/${id}`, 'DELETE');
}

export function listDepartments(): Promise<DepartmentSummary[]> {
	return api<DepartmentSummary[]>('/departments');
}

export function createDepartment(body: CreateDepartmentRequest): Promise<DepartmentSummary> {
	return apiSend<DepartmentSummary>('/departments', 'POST', body);
}

export function deleteDepartment(id: string): Promise<void> {
	return apiSend<void>(`/departments/${id}`, 'DELETE');
}

export function listTeams(departmentId?: string): Promise<TeamSummary[]> {
	return api<TeamSummary[]>(`/teams${departmentId ? `?departmentId=${departmentId}` : ''}`);
}

export function createTeam(body: CreateTeamRequest): Promise<TeamSummary> {
	return apiSend<TeamSummary>('/teams', 'POST', body);
}

export function listInvitations(): Promise<InvitationSummary[]> {
	return api<InvitationSummary[]>('/invitations');
}

/** The response carries the only copy of the token — the server keeps just its hash. */
export function createInvitation(body: CreateInvitationRequest): Promise<CreatedInvitation> {
	return apiSend<CreatedInvitation>('/invitations', 'POST', body);
}

export function revokeInvitation(id: string): Promise<void> {
	return apiSend<void>(`/invitations/${id}`, 'DELETE');
}
