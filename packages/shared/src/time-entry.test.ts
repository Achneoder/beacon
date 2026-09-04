import { describe, expect, it } from 'vitest';
import { amountFor, isTimeEntryRunning } from './time-entry.js';

describe('isTimeEntryRunning', () => {
  it('is running exactly when started and not yet ended', () => {
    expect(isTimeEntryRunning({ startedAt: '2026-09-04T09:00:00Z', endedAt: null })).toBe(true);
  });

  it('is not running once stopped', () => {
    expect(
      isTimeEntryRunning({ startedAt: '2026-09-04T09:00:00Z', endedAt: '2026-09-04T10:00:00Z' }),
    ).toBe(false);
  });

  it('is not running for a duration-only manual entry', () => {
    expect(isTimeEntryRunning({ startedAt: null, endedAt: null })).toBe(false);
  });
});

describe('amountFor', () => {
  it('prices a whole hour at the hourly rate', () => {
    expect(amountFor(60, 90)).toBe(90);
  });

  it('rounds to the nearest cent', () => {
    // 37 minutes at 95/h = 58.5833... -> 58.58
    expect(amountFor(37, 95)).toBe(58.58);
  });

  it('is zero for zero minutes', () => {
    expect(amountFor(0, 150)).toBe(0);
  });
});
