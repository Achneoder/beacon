import type {
	CreateManualTimeEntryRequest,
	StartTimerRequest,
	TimeEntrySummary,
	UpdateTimeEntryRequest
} from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * Time booked against a project or task — independent of attendance clock-in/out.
 * Every shape comes from `@beacon/shared`; the API is the only contract.
 */

export function listMyTimeEntries(
	options: { from?: string; to?: string; projectId?: string } = {}
): Promise<TimeEntrySummary[]> {
	const params = new URLSearchParams();
	if (options.from) params.set('from', options.from);
	if (options.to) params.set('to', options.to);
	if (options.projectId) params.set('projectId', options.projectId);

	return api<TimeEntrySummary[]>(`/time-entries?${params}`);
}

/**
 * `undefined` when nothing is running — the API answers with a 204, and `api()` maps
 * that to `undefined` rather than trying to parse an empty body as JSON.
 */
export function getRunningTimer(): Promise<TimeEntrySummary | undefined> {
	return api<TimeEntrySummary | undefined>('/time-entries/running');
}

export function startTimer(body: StartTimerRequest): Promise<TimeEntrySummary> {
	return apiSend<TimeEntrySummary>('/time-entries/start', 'POST', body);
}

export function stopTimer(id: string): Promise<TimeEntrySummary> {
	return apiSend<TimeEntrySummary>(`/time-entries/${id}/stop`, 'POST');
}

export function createManualTimeEntry(
	body: CreateManualTimeEntryRequest
): Promise<TimeEntrySummary> {
	return apiSend<TimeEntrySummary>('/time-entries', 'POST', body);
}

export function updateTimeEntry(
	id: string,
	body: UpdateTimeEntryRequest
): Promise<TimeEntrySummary> {
	return apiSend<TimeEntrySummary>(`/time-entries/${id}`, 'PATCH', body);
}

export function deleteTimeEntry(id: string): Promise<void> {
	return apiSend<void>(`/time-entries/${id}`, 'DELETE');
}
