import { describe, expect, it } from 'vitest';
import { durationToSeconds } from './refresh-cookie.js';

describe('durationToSeconds', () => {
  it.each([
    ['15m', 900],
    ['30d', 2_592_000],
    ['2h', 7200],
    ['45s', 45],
    ['3600', 3600],
  ])('parses %s', (input, expected) => {
    expect(durationToSeconds(input, 1)).toBe(expected);
  });

  it('falls back when the value is not a duration', () => {
    expect(durationToSeconds('forever', 42)).toBe(42);
  });
});
