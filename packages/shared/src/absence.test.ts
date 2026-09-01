import { describe, expect, it } from 'vitest';
import {
  absenceCostByYear,
  absenceCostDays,
  absenceCostMinutes,
  datesBetween,
  formatDays,
  isCommitted,
  isWeekend,
  rangesOverlap,
  remainingLeaveDays,
  workingDaysBetween,
} from './absence.js';
import { weekdayOf } from './attendance.js';

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

describe('absenceCostMinutes', () => {
  // Mon–Thu nine hours, Fri four: the part-time pattern the day-count cannot see.
  const PART_TIME: Record<string, number> = {
    monday: 540,
    tuesday: 540,
    wednesday: 540,
    thursday: 540,
    friday: 240,
    saturday: 0,
    sunday: 0,
  };
  const partTime = (date: string) => PART_TIME[weekdayOf(date)] ?? 0;
  const fullTime = () => 480;

  it('sums the working days of the range', () => {
    // Mon 24 – Fri 28 Aug 2026, five full-time days.
    expect(absenceCostMinutes({ startsOn: '2026-08-24', endsOn: '2026-08-28' }, fullTime)).toBe(
      2400,
    );
  });

  it('charges each weekday its own hours, not an average', () => {
    // The same week under the part-time pattern: 4 × 9 h + 4 h, not 5 × 8 h.
    expect(absenceCostMinutes({ startsOn: '2026-08-24', endsOn: '2026-08-28' }, partTime)).toBe(
      2400 - 240 + 240,
    );
    expect(absenceCostMinutes({ startsOn: '2026-08-28', endsOn: '2026-08-28' }, partTime)).toBe(240);
  });

  it('skips weekends and public holidays', () => {
    expect(absenceCostMinutes({ startsOn: '2026-08-29', endsOn: '2026-08-30' }, fullTime)).toBe(0);
    expect(
      absenceCostMinutes({ startsOn: '2026-08-24', endsOn: '2026-08-28' }, fullTime, [
        '2026-08-26',
      ]),
    ).toBe(1920);
  });

  it('halves the boundary day by its own length', () => {
    // Half of a four-hour Friday is two hours, not half of a notional eight.
    expect(
      absenceCostMinutes(
        { startsOn: '2026-08-24', endsOn: '2026-08-28', halfDayEnd: true },
        partTime,
      ),
    ).toBe(2400 - 120);
  });

  it('halves a one-day request once, whichever flag says so', () => {
    const request = { startsOn: '2026-08-24', endsOn: '2026-08-24' };

    expect(absenceCostMinutes({ ...request, halfDayStart: true }, fullTime)).toBe(240);
    expect(
      absenceCostMinutes({ ...request, halfDayStart: true, halfDayEnd: true }, fullTime),
    ).toBe(240);
  });

  it('costs nothing when the range holds no working day', () => {
    expect(absenceCostMinutes({ startsOn: '2026-08-30', endsOn: '2026-08-24' }, fullTime)).toBe(0);
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
