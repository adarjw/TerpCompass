import { describe, expect, it } from 'vitest';
import { datesForPattern, localDateTime, parseTime, addDaysISO } from './time';

describe('datesForPattern', () => {
  it('generates weekly recurring dates across a DST spring-forward transition', () => {
    // US spring-forward 2026-03-08. A Sunday/Monday/Wednesday pattern should
    // still produce one date per week with no skips or dupes.
    const dates = datesForPattern('2026-03-02', '2026-03-16', [1, 3]);
    expect(dates).toEqual(['2026-03-02', '2026-03-04', '2026-03-09', '2026-03-11', '2026-03-16']);
  });

  it('generates weekly recurring dates across a DST fall-back transition', () => {
    // US fall-back 2026-11-01.
    const dates = datesForPattern('2026-10-26', '2026-11-09', [1, 3]);
    expect(dates).toEqual(['2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04', '2026-11-09']);
  });

  it('preserves local wall-clock start time across a DST transition', () => {
    const before = localDateTime('2026-03-01', '14:00')!;
    const after = localDateTime('2026-03-09', '14:00')!;
    expect(before.getHours()).toBe(14);
    expect(after.getHours()).toBe(14);
  });

  it('excludes holiday dates from the pattern', () => {
    const dates = datesForPattern('2026-11-23', '2026-11-27', [1, 2, 3, 4, 5], new Set(['2026-11-26']));
    expect(dates).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27']);
  });

  it('returns nothing for an empty weekday list', () => {
    expect(datesForPattern('2026-01-01', '2026-01-31', [])).toEqual([]);
  });
});

describe('parseTime', () => {
  it('parses valid HH:MM', () => {
    expect(parseTime('09:30')).toBe(9 * 60 + 30);
  });
  it('rejects malformed time', () => {
    expect(parseTime('9:99')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});

describe('addDaysISO', () => {
  it('rolls over month and year boundaries', () => {
    expect(addDaysISO('2026-12-30', 5)).toBe('2027-01-04');
  });
});
