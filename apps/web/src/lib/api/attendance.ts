import type {
	AttendanceSegment,
	ClockRequest,
	CorrectionSummary,
	CreateCorrectionRequest,
	DecideCorrectionRequest,
	TimesheetWeek,
	TodayStatus,
	WorkScheduleSummary
} from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * The attendance half of the REST API. Every shape comes from `@beacon/shared` — the
 * API is the only contract, so nothing is redeclared here.
 *
 * Each clock call answers with the whole of today rather than an acknowledgement, so
 * the sidebar and the Today screen cannot end up describing different states.
 */

export function getToday(): Promise<TodayStatus> {
	return api<TodayStatus>('/attendance/me/today');
}

export function clockIn(body: ClockRequest = {}): Promise<TodayStatus> {
	return apiSend<TodayStatus>('/attendance/clock-in', 'POST', body);
}

export function clockOut(): Promise<TodayStatus> {
	return apiSend<TodayStatus>('/attendance/clock-out', 'POST', {});
}

export function startBreak(): Promise<TodayStatus> {
	return apiSend<TodayStatus>('/attendance/breaks/start', 'POST', {});
}

export function stopBreak(): Promise<TodayStatus> {
	return apiSend<TodayStatus>('/attendance/breaks/stop', 'POST', {});
}

/** `offset` is relative to the current week: 0 is this one, -1 the one before. */
export function getWeek(offset = 0, userId?: string): Promise<TimesheetWeek> {
	const params = new URLSearchParams({ offset: String(offset) });
	if (userId) params.set('userId', userId);

	return api<TimesheetWeek>(`/attendance/me/week?${params}`);
}

export function getSchedule(userId?: string): Promise<WorkScheduleSummary> {
	return api<WorkScheduleSummary>(`/attendance/me/schedule${userId ? `?userId=${userId}` : ''}`);
}

export function listSegments(
	from: string,
	to: string,
	userId?: string
): Promise<AttendanceSegment[]> {
	const params = new URLSearchParams({ from, to });
	if (userId) params.set('userId', userId);

	return api<AttendanceSegment[]>(`/attendance?${params}`);
}

/** Own requests, or the approval queue when `mine` is false and the caller may approve. */
export function listCorrections(mine = true): Promise<CorrectionSummary[]> {
	return api<CorrectionSummary[]>(`/attendance/corrections?mine=${mine}`);
}

export function requestCorrection(body: CreateCorrectionRequest): Promise<CorrectionSummary> {
	return apiSend<CorrectionSummary>('/attendance/corrections', 'POST', body);
}

export function approveCorrection(
	id: string,
	body: DecideCorrectionRequest = {}
): Promise<CorrectionSummary> {
	return apiSend<CorrectionSummary>(`/attendance/corrections/${id}/approve`, 'POST', body);
}

export function rejectCorrection(
	id: string,
	body: DecideCorrectionRequest = {}
): Promise<CorrectionSummary> {
	return apiSend<CorrectionSummary>(`/attendance/corrections/${id}/reject`, 'POST', body);
}
