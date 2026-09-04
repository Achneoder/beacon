import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { resolveManualDuration } from './time-entries.service.js';

/**
 * A manual booking gives exactly one of a duration or a start/end pair. Pinned down
 * without a database, the same shape `resolveClockOutAt` is tested with.
 */
describe('resolveManualDuration', () => {
  it('accepts a duration alone', () => {
    expect(resolveManualDuration({ durationMinutes: 90 })).toEqual({
      durationMinutes: 90,
      startedAt: null,
      endedAt: null,
    });
  });

  it('computes the duration from a start and end pair', () => {
    const startedAt = '2026-09-04T09:00:00.000Z';
    const endedAt = '2026-09-04T10:30:00.000Z';

    expect(resolveManualDuration({ startedAt, endedAt })).toEqual({
      durationMinutes: 90,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
    });
  });

  it('refuses both a duration and a range', () => {
    expect(() =>
      resolveManualDuration({
        durationMinutes: 90,
        startedAt: '2026-09-04T09:00:00.000Z',
        endedAt: '2026-09-04T10:30:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses neither a duration nor a range', () => {
    expect(() => resolveManualDuration({})).toThrow(BadRequestException);
  });

  it('refuses a range with only a start', () => {
    expect(() => resolveManualDuration({ startedAt: '2026-09-04T09:00:00.000Z' })).toThrow(
      BadRequestException,
    );
  });

  it('refuses an end before the start', () => {
    expect(() =>
      resolveManualDuration({
        startedAt: '2026-09-04T10:30:00.000Z',
        endedAt: '2026-09-04T09:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses a zero or negative duration', () => {
    expect(() => resolveManualDuration({ durationMinutes: 0 })).toThrow(BadRequestException);
    expect(() => resolveManualDuration({ durationMinutes: -15 })).toThrow(BadRequestException);
  });

  it('refuses an unparseable instant', () => {
    expect(() =>
      resolveManualDuration({ startedAt: 'not-a-date', endedAt: '2026-09-04T10:30:00.000Z' }),
    ).toThrow(BadRequestException);
  });
});
