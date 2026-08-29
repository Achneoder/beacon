import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CLOCK_SKEW_TOLERANCE_MS } from '@beacon/shared';
import { resolveClockOutAt } from './attendance.service.js';

/**
 * The bound on a client-supplied clock-out instant. The desktop client needs to be
 * able to say "the machine slept at 17:02"; nobody needs to be able to say "I worked
 * until tomorrow".
 */
describe('resolveClockOutAt', () => {
  const startedAt = new Date('2026-08-29T09:00:00.000Z');
  const now = new Date('2026-08-29T17:30:00.000Z');

  it('falls back to now when the client names no instant', () => {
    expect(resolveClockOutAt(undefined, startedAt, now)).toEqual(now);
  });

  it('accepts an instant between the clock-in and now', () => {
    const at = '2026-08-29T17:02:00.000Z';

    expect(resolveClockOutAt(at, startedAt, now)).toEqual(new Date(at));
  });

  it('accepts the clock-in instant itself, for a zero-length entry', () => {
    expect(resolveClockOutAt(startedAt.toISOString(), startedAt, now)).toEqual(startedAt);
  });

  it('refuses an instant before the clock-in', () => {
    expect(() => resolveClockOutAt('2026-08-29T08:59:59.000Z', startedAt, now)).toThrow(
      BadRequestException,
    );
  });

  it('refuses an instant beyond the skew tolerance', () => {
    const ahead = new Date(now.getTime() + CLOCK_SKEW_TOLERANCE_MS + 1_000);

    expect(() => resolveClockOutAt(ahead.toISOString(), startedAt, now)).toThrow(
      BadRequestException,
    );
  });

  it('clamps a client running slightly fast back to the server clock', () => {
    const ahead = new Date(now.getTime() + 5_000);

    expect(resolveClockOutAt(ahead.toISOString(), startedAt, now)).toEqual(now);
  });

  it('refuses something that is not an instant at all', () => {
    expect(() => resolveClockOutAt('yesterday', startedAt, now)).toThrow(BadRequestException);
  });
});
