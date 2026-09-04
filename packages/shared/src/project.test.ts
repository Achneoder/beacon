import { describe, expect, it } from 'vitest';
import { effectiveHourlyRate } from './project.js';

describe('effectiveHourlyRate', () => {
  it("falls back to the project's rate when the task has none", () => {
    expect(effectiveHourlyRate({ hourlyRate: 80 }, { hourlyRate: null })).toBe(80);
  });

  it('lets a task override the rate it is nested under', () => {
    expect(effectiveHourlyRate({ hourlyRate: 80 }, { hourlyRate: 120 })).toBe(120);
  });

  it('is null when neither the project nor the task has a rate', () => {
    expect(effectiveHourlyRate({ hourlyRate: null }, { hourlyRate: null })).toBeNull();
  });

  it('reads the project alone when no task is booked against', () => {
    expect(effectiveHourlyRate({ hourlyRate: 80 }, null)).toBe(80);
    expect(effectiveHourlyRate({ hourlyRate: 80 }, undefined)).toBe(80);
  });
});
