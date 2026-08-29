import type { AbsenceSummary, AttendanceSummary, ReportGroupBy } from '@beacon/shared';
import { api, apiDownload, saveBlob } from './client';

/**
 * The reporting half of the REST API. Every shape comes from `@beacon/shared` — the
 * API is the only contract, so nothing is redeclared here.
 *
 * No route takes a `userId`: `report:read` says whether the caller may see a report
 * and the server decides whose, so there is nothing for the client to ask for and
 * nothing it could ask for that would widen the answer.
 */

export interface AttendanceReportQuery {
	from: string;
	to: string;
	groupBy?: ReportGroupBy;
}

export function getAttendanceSummary(query: AttendanceReportQuery): Promise<AttendanceSummary> {
	const params = new URLSearchParams({ from: query.from, to: query.to });
	if (query.groupBy) params.set('groupBy', query.groupBy);

	return api<AttendanceSummary>(`/reports/attendance/summary?${params}`);
}

export function getAbsenceSummary(year: number): Promise<AbsenceSummary> {
	return api<AbsenceSummary>(`/reports/absences/summary?year=${year}`);
}

/**
 * Fetches the export and hands it to the browser.
 *
 * The server names the file — it knows the range it actually served, which is not
 * always the one the client asked for — and `fallback` covers a proxy that strips
 * `Content-Disposition`.
 */
export async function downloadAttendanceCsv(
	query: { from: string; to: string },
	fallback: string
): Promise<void> {
	const params = new URLSearchParams({ from: query.from, to: query.to, format: 'csv' });
	const { blob, filename } = await apiDownload(`/reports/attendance/export?${params}`);

	saveBlob(blob, filename ?? fallback);
}
