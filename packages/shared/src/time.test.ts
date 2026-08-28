import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatSignedDuration, secondsSince } from './time.js';

describe('formatDuration', () => {
  it('writes H:MM with an unpadded hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(455)).toBe('7:35');
    expect(formatDuration(5)).toBe('0:05');
  });

  it('carries past 24 hours rather than wrapping', () => {
    expect(formatDuration(2475)).toBe('41:15');
  });

  it('drops the sign', () => {
    expect(formatDuration(-95)).toBe('1:35');
  });
});

describe('formatSignedDuration', () => {
  it('signs a balance in both directions and leaves zero bare', () => {
    expect(formatSignedDuration(860)).toBe('+14:20');
    expect(formatSignedDuration(-20)).toBe('-0:20');
    expect(formatSignedDuration(0)).toBe('0:00');
  });
});

describe('formatClock', () => {
  it('pads every field so the ticking readout keeps its width', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(3 * 3600 + 7 * 60 + 9)).toBe('03:07:09');
  });

  it('floors a fraction and refuses to go negative', () => {
    expect(formatClock(59.9)).toBe('00:00:59');
    expect(formatClock(-5)).toBe('00:00:00');
  });
});

describe('secondsSince', () => {
  it('measures from a server-supplied instant', () => {
    const now = new Date('2026-08-28T11:32:47Z');
    expect(secondsSince('2026-08-28T09:12:00Z', now)).toBe(8447);
  });

  it('clamps a future start to zero rather than counting down', () => {
    const now = new Date('2026-08-28T09:00:00Z');
    expect(secondsSince(new Date('2026-08-28T09:00:30Z'), now)).toBe(0);
  });
});
