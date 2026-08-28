import { describe, expect, it } from 'vitest';
import {
  absenceCostByYear,
  absenceCostDays,
  datesBetween,
  formatDays,
  isCommitted,
  isWeekend,
  rangesOverlap,
  remainingLeaveDays,
  workingDaysBetween,
} from './absence.js';

describe('isWeekend', () => {
  it('names Saturday and Sunday', () => {
    // 2026-08-29 is a Saturday, 2026-08-30 a Sunday.
    expect(isWeekend('2026-08-29')).toBe(true);
    expect(isWeekend('2026-08-30')).toBe(true);
    expect(isWeekend('2026-08-28')).toBe(false);
  });
});

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween('2026-08-28', '2026-08-30')).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(datesBetween('2026-08-31', '2026-09-01')).toEqual(['2026-08-31', '2026-09-01']);
  });

  it('is empty when the range runs backwards', () => {
    expect(datesBetween('2026-08-30', '2026-08-28')).toEqual([]);
  });
});

describe('workingDaysBetween', () => {
  it('drops weekends', () => {
    // Mon 24 Aug to Sun 30 Aug 2026.
    expect(workingDaysBetween('2026-08-24', '2026-08-30')).toHaveLength(5);
  });

  it('drops public holidays', () => {
    expect(workingDaysBetween('2026-08-24', '2026-08-28', ['2026-08-26'])).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-27',
      '2026-08-28',
    ]);
  });
});

describe('absenceCostDays', () => {
  it('counts a plain working week as five days', () => {
    expect(absenceCostDays({ startsOn: '2026-08-24', endsOn: '2026-08-28' })).toBe(5);
  });

  it('discounts each half day', () => {
    expect(
      absenceCostDays({
        startsOn: '2026-08-24',
        endsOn: '2026-08-28',
        halfDayStart: true,
        halfDayEnd: true,
      }),
    ).toBe(4);
  });

  it('reads a single day flagged at both ends as half a day', () => {
    expect(
      absenceCostDays({
        startsOn: '2026-08-28',
        endsOn: '2026-08-28',
        halfDayStart: true,
        halfDayEnd: true,
      }),
    ).toBe(0.5);
  });

  it('ignores a half day on a boundary that is not worked anyway', () => {
    // Sat–Sun: no working days, so no discount can make the cost negative.
    expect(
      absenceCostDays({
        startsOn: '2026-08-29',
        endsOn: '2026-08-30',
        halfDayStart: true,
        halfDayEnd: true,
      }),
    ).toBe(0);
  });

  it('subtracts public holidays inside the range', () => {
    expect(absenceCostDays({ startsOn: '2026-08-24', endsOn: '2026-08-28' }, ['2026-08-26'])).toBe(
      4,
    );
  });
});

describe('absenceCostByYear', () => {
  it('charges each year the days that fall in it', () => {
    // Mon 28 Dec 2026 – Fri 1 Jan 2027: four working days in 2026, one in 2027.
    const byYear = absenceCostByYear({ startsOn: '2026-12-28', endsOn: '2027-01-01' });

    expect(byYear.get(2026)).toBe(4);
    expect(byYear.get(2027)).toBe(1);
  });

  it('keeps a half day on the year that owns the boundary', () => {
    const byYear = absenceCostByYear({
      startsOn: '2026-12-28',
      endsOn: '2027-01-01',
      halfDayStart: true,
      halfDayEnd: true,
    });

    expect(byYear.get(2026)).toBe(3.5);
    expect(byYear.get(2027)).toBe(0.5);
  });

  it('leaves a year out entirely when it costs nothing', () => {
    // Fri 1 Jan 2027 is a holiday: 2027 contributes no working day at all.
    const byYear = absenceCostByYear({ startsOn: '2026-12-30', endsOn: '2027-01-01' }, [
      '2027-01-01',
    ]);

    expect(byYear.has(2027)).toBe(false);
    expect(byYear.get(2026)).toBe(2);
  });
});

describe('remainingLeaveDays', () => {
  const balance = {
    entitlementDays: 30,
    carryOverDays: 5,
    carryOverExpiresOn: '2026-03-31',
    takenDays: 12,
  };

  it('counts carry-over while it is still alive', () => {
    expect(remainingLeaveDays(balance, '2026-03-31')).toBe(23);
  });

  it('drops carry-over the day after it expires', () => {
    expect(remainingLeaveDays(balance, '2026-04-01')).toBe(18);
  });

  it('keeps carry-over that never expires', () => {
    expect(remainingLeaveDays({ ...balance, carryOverExpiresOn: null }, '2026-12-31')).toBe(23);
  });

  it('survives half days without a floating-point tail', () => {
    expect(remainingLeaveDays({ ...balance, takenDays: 12.5 }, '2026-01-10')).toBe(22.5);
  });
});

describe('rangesOverlap', () => {
  it('sees a touching pair', () => {
    expect(
      rangesOverlap(
        { startsOn: '2026-08-24', endsOn: '2026-08-28' },
        { startsOn: '2026-08-28', endsOn: '2026-08-31' },
      ),
    ).toBe(true);
  });

  it('separates a disjoint pair', () => {
    expect(
      rangesOverlap(
        { startsOn: '2026-08-24', endsOn: '2026-08-27' },
        { startsOn: '2026-08-28', endsOn: '2026-08-31' },
      ),
    ).toBe(false);
  });
});

describe('isCommitted', () => {
  it('holds days for approved and taken, not for pending or rejected', () => {
    expect(isCommitted('approved')).toBe(true);
    expect(isCommitted('taken')).toBe(true);
    expect(isCommitted('pending')).toBe(false);
    expect(isCommitted('rejected')).toBe(false);
  });
});

describe('formatDays', () => {
  it('drops the decimal on a whole day', () => {
    expect(formatDays(5)).toBe('5');
    expect(formatDays(0.5)).toBe('0.5');
    expect(formatDays(2.5)).toBe('2.5');
  });
});
