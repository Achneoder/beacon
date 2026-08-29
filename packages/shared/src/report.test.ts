import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvHours, csvRow, isReportGroupBy } from './report.js';

describe('csvCell', () => {
  it('leaves ordinary text alone', () => {
    expect(csvCell('Ada Lovelace')).toBe('Ada Lovelace');
    expect(csvCell('BCN-0148')).toBe('BCN-0148');
  });

  it('renders nothing for null and undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a cell containing the separator', () => {
    expect(csvCell('Lovelace, Ada')).toBe('"Lovelace, Ada"');
    // Semicolon too: a German Excel splits on it, so an unquoted one is a new column.
    expect(csvCell('Lovelace; Ada')).toBe('"Lovelace; Ada"');
  });

  it('doubles an embedded quote and wraps the cell', () => {
    expect(csvCell('she said "hello"')).toBe('"she said ""hello"""');
  });

  it('quotes newlines, LF and CRLF alike', () => {
    expect(csvCell('first\nsecond')).toBe('"first\nsecond"');
    expect(csvCell('first\r\nsecond')).toBe('"first\r\nsecond"');
  });

  // A name, a note or a correction reason is user-supplied text that lands in a
  // spreadsheet. Each of these opens a formula unless it is disarmed.
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)'])('disarms the formula %s', (value) => {
    expect(csvCell(value)).toBe(`'${value}`);
  });

  it('disarms a formula that also needs quoting', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(
      '"\'=HYPERLINK(""http://x"",""y"")"',
    );
  });

  it('leaves a negative number alone, so the column can still be summed', () => {
    expect(csvCell(-95)).toBe('-95');
    expect(csvCell('-1.58')).toBe('-1.58');
    expect(csvCell(0)).toBe('0');
  });
});

describe('csvRow', () => {
  it('escapes every cell and joins them', () => {
    expect(csvRow(['Ada', 'Lovelace, A', -1.5, null])).toBe('Ada,"Lovelace, A",-1.5,');
  });

  it('adds no line ending of its own', () => {
    expect(csvRow(['a', 'b'])).toBe('a,b');
  });
});

describe('csvHours', () => {
  it('renders minutes as decimal hours a spreadsheet can add', () => {
    expect(csvHours(455)).toBe('7.58');
    expect(csvHours(480)).toBe('8.00');
    expect(csvHours(0)).toBe('0.00');
  });

  it('keeps the sign on a negative balance', () => {
    expect(csvHours(-95)).toBe('-1.58');
  });
});

describe('CSV_BOM', () => {
  it('is the single byte-order mark Excel looks for', () => {
    expect(CSV_BOM).toBe('\uFEFF');
    expect(CSV_BOM).toHaveLength(1);
  });
});

describe('isReportGroupBy', () => {
  it('accepts the two groupings and refuses anything else', () => {
    expect(isReportGroupBy('user')).toBe(true);
    expect(isReportGroupBy('department')).toBe(true);
    expect(isReportGroupBy('team')).toBe(false);
    expect(isReportGroupBy('')).toBe(false);
  });
});
