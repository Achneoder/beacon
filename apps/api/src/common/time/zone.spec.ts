import { describe, expect, it } from 'vitest';
import { localDate, offsetMinutes, resolveTimezone } from './zone.js';

describe('resolveTimezone', () => {
  it('prefers the user, falls back to the organization', () => {
    expect(resolveTimezone('Europe/Berlin', 'UTC')).toBe('Europe/Berlin');
    expect(resolveTimezone(null, 'Europe/Vienna')).toBe('Europe/Vienna');
  });

  it('falls back to UTC rather than throwing on a zone the runtime rejects', () => {
    expect(resolveTimezone('Mars/Olympus', 'UTC')).toBe('UTC');
  });
});

describe('localDate', () => {
  it('is the calendar date where the person is, not where the server is', () => {
    // 23:30 UTC is already the next day in Berlin.
    const at = new Date('2026-08-28T23:30:00Z');

    expect(localDate('UTC', at)).toBe('2026-08-28');
    expect(localDate('Europe/Berlin', at)).toBe('2026-08-29');
    expect(localDate('America/New_York', at)).toBe('2026-08-28');
  });
});

describe('offsetMinutes', () => {
  it('follows daylight saving rather than assuming a fixed offset', () => {
    expect(offsetMinutes('Europe/Berlin', new Date('2026-08-28T12:00:00Z'))).toBe(120);
    expect(offsetMinutes('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(60);
  });

  it('is negative west of Greenwich', () => {
    expect(offsetMinutes('America/New_York', new Date('2026-08-28T12:00:00Z'))).toBe(-240);
  });

  it('handles a zone that is not a whole hour off', () => {
    expect(offsetMinutes('Asia/Kolkata', new Date('2026-08-28T12:00:00Z'))).toBe(330);
  });
});
