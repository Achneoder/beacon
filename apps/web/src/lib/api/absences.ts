import type {
	AbsenceCalendar,
	AbsenceRequestSummary,
	AbsenceStatus,
	AbsenceTypeSummary,
	CreateAbsenceRequest,
	DecideAbsenceRequest,
	HolidaySummary,
	LeaveBalanceSummary
} from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * The absence half of the REST API. Every shape comes from `@beacon/shared` — the
 * API is the only contract, so nothing is redeclared here.
 *
 * The cost of a selection is computed in the browser from the same shared arithmetic
 * the server uses, so the calendar can print `5 days · Vacation` before anything is
 * sent; the figure the server freezes onto the row is still the one that counts.
 */

export function listAbsences(
	options: { userId?: string; status?: AbsenceStatus; mine?: boolean } = {}
): Promise<AbsenceRequestSummary[]> {
	const params = new URLSearchParams();
	if (options.userId) params.set('userId', options.userId);
	if (options.status) params.set('status', options.status);
	if (options.mine) params.set('mine', 'true');

	return api<AbsenceRequestSummary[]>(`/absences?${params}`);
}

export function createAbsence(body: CreateAbsenceRequest): Promise<AbsenceRequestSummary> {
	return apiSend<AbsenceRequestSummary>('/absences', 'POST', body);
}

/** Withdrawing your own request, and only while it is still pending. */
export function withdrawAbsence(id: string): Promise<void> {
	return apiSend<void>(`/absences/${id}`, 'DELETE');
}

export function approveAbsence(
	id: string,
	body: DecideAbsenceRequest = {}
): Promise<AbsenceRequestSummary> {
	return apiSend<AbsenceRequestSummary>(`/absences/${id}/approve`, 'POST', body);
}

export function rejectAbsence(
	id: string,
	body: DecideAbsenceRequest = {}
): Promise<AbsenceRequestSummary> {
	return apiSend<AbsenceRequestSummary>(`/absences/${id}/reject`, 'POST', body);
}

/** `scope` widens the grid: your own days, your reports', or the organization's. */
export function getCalendar(
	from: string,
	to: string,
	scope: 'me' | 'team' | 'organization' = 'team'
): Promise<AbsenceCalendar> {
	return api<AbsenceCalendar>(`/absences/calendar?from=${from}&to=${to}&scope=${scope}`);
}

export function listAbsenceTypes(): Promise<AbsenceTypeSummary[]> {
	return api<AbsenceTypeSummary[]>('/absences/types');
}

export function getLeaveBalance(year?: number): Promise<LeaveBalanceSummary> {
	return api<LeaveBalanceSummary>(`/absences/balances/me${year ? `?year=${year}` : ''}`);
}

export function listHolidays(from: string, to: string): Promise<HolidaySummary[]> {
	return api<HolidaySummary[]>(`/absences/holidays?from=${from}&to=${to}`);
}

/** The settings half — retired types are only ever listed here. */
export function listAllAbsenceTypes(): Promise<AbsenceTypeSummary[]> {
	return api<AbsenceTypeSummary[]>('/absence-types');
}

export function retireAbsenceType(id: string): Promise<AbsenceTypeSummary> {
	return apiSend<AbsenceTypeSummary>(`/absence-types/${id}`, 'DELETE');
}

export function createHoliday(body: {
	date: string;
	name: string;
	region?: string | null;
}): Promise<HolidaySummary> {
	return apiSend<HolidaySummary>('/public-holidays', 'POST', body);
}

export function deleteHoliday(id: string): Promise<void> {
	return apiSend<void>(`/public-holidays/${id}`, 'DELETE');
}
