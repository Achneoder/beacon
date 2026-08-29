import { Readable } from 'node:stream';
import { CSV_BOM, csvHours, csvRow, type ReportRange } from '@beacon/shared';
import type { AttendanceCsvRow } from './reports.service.js';

/**
 * The header row. English and fixed, not localized: a CSV is read by a spreadsheet
 * and by whatever script the payroll team wrote, and a column name that changed with
 * the caller's locale would break both.
 */
const HEADER = [
  'employee_number',
  'name',
  'email',
  'department',
  'date',
  'worked_hours',
  'break_hours',
  'expected_hours',
  'credited_hours',
  'balance_hours',
  'absence',
  'holiday',
] as const;

/**
 * The export as a stream.
 *
 * Streamed rather than joined into one string because a year across an organization is
 * hundreds of thousands of lines, and buffering it would hold the whole file in the
 * API's heap to hand it to a socket that is going to take it a chunk at a time anyway.
 * `Readable.from` over a generator gives back-pressure for free.
 *
 * Durations go out as decimal hours, not as the `H:MM` the screens print: `7:35` is
 * text to a spreadsheet and `7.58` is a number, and adding the column up is the reason
 * the file exists.
 */
export function attendanceCsvStream(rows: Iterable<AttendanceCsvRow>): Readable {
  return Readable.from(lines(rows), { objectMode: false });
}

function* lines(rows: Iterable<AttendanceCsvRow>): Generator<string> {
  // The BOM goes out with the header so Excel reads the file as UTF-8 rather than as
  // the host's legacy code page — without it every umlaut in a German name is mojibake.
  yield `${CSV_BOM}${csvRow(HEADER)}\r\n`;

  for (const row of rows) {
    yield `${csvRow([
      row.employeeNumber,
      row.name,
      row.email,
      row.department,
      row.date,
      csvHours(row.workedMinutes),
      csvHours(row.breakMinutes),
      csvHours(row.expectedMinutes),
      csvHours(row.creditedMinutes),
      csvHours(row.balanceMinutes),
      row.absenceTag,
      row.holiday,
    ])}\r\n`;
  }
}

/** `beacon-attendance-2026-08-01-to-2026-08-31.csv`. */
export function attendanceCsvFilename(range: ReportRange): string {
  return `beacon-attendance-${range.from}-to-${range.to}.csv`;
}
