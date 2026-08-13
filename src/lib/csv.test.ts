import { describe, expect, it } from 'vitest';
import { normalizeDate, normalizeTime, parseCsvSchedule, parseMeetingDays } from './csv';

describe('parseMeetingDays', () => {
  it('parses compact MWF', () => {
    expect(parseMeetingDays('MWF')).toEqual([1, 3, 5]);
  });
  it('parses compact TuTh', () => {
    expect(parseMeetingDays('TuTh')).toEqual([2, 4]);
  });
  it('parses comma-separated full names', () => {
    expect(parseMeetingDays('Monday, Wednesday')).toEqual([1, 3]);
  });
});

describe('normalizeTime', () => {
  it('parses 12-hour with am/pm', () => {
    expect(normalizeTime('2:15 PM')).toBe('14:15');
  });
  it('parses 24-hour', () => {
    expect(normalizeTime('14:15')).toBe('14:15');
  });
  it('rejects garbage', () => {
    expect(normalizeTime('not a time')).toBeNull();
  });
});

describe('normalizeDate', () => {
  it('parses US-style dates', () => {
    expect(normalizeDate('8/31/2026')).toBe('2026-08-31');
  });
  it('passes through ISO dates', () => {
    expect(normalizeDate('2026-08-31')).toBe('2026-08-31');
  });
});

describe('parseCsvSchedule', () => {
  const csv = [
    'code,name,professor,building,room,days,start,end,semester_start,semester_end',
    'CMSC216,Intro to Computer Systems,Rivera,IRB,0324,MWF,10:00,10:50,2026-08-31,2026-12-14',
    'MATH241,Calc III,Osei,MTH,0102,TuTh,12:30,13:45,2026-08-31,2026-12-14',
  ].join('\n');

  it('parses a well-formed schedule', () => {
    const result = parseCsvSchedule(csv);
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].patterns).toHaveLength(1);
    expect(result.courses[0].patterns[0].meetingDays).toEqual([1, 3, 5]);
    expect(result.courses[0].patterns[0].label).toBe('lecture');
    expect(result.warnings).toEqual([]);
  });

  it('merges a lecture and discussion row sharing the same code into one course', () => {
    const withDis = [
      'code,name,professor,component,building,room,days,start,end,semester_start,semester_end',
      'MATH246,Differential Equations,Osei,Lecture,MTH,0102,TuTh,11:00,12:15,2026-08-31,2026-12-14',
      'MATH246,Differential Equations,Osei,Discussion,MTH,0101,F,12:00,12:50,2026-08-31,2026-12-14',
    ].join('\n');
    const result = parseCsvSchedule(withDis);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].patterns).toHaveLength(2);
    expect(result.courses[0].patterns.map((p) => p.label).sort()).toEqual(['discussion', 'lecture']);
  });

  it('reports missing required columns instead of guessing', () => {
    const result = parseCsvSchedule('name,professor\nFoo,Bar');
    expect(result.courses).toEqual([]);
    expect(result.warnings[0]).toMatch(/missing required column/i);
  });

  it('skips a row with an invalid time range and explains why', () => {
    const bad = [
      'code,days,start,end,semester_start,semester_end',
      'CMSC216,MWF,10:50,10:00,2026-08-31,2026-12-14',
    ].join('\n');
    const result = parseCsvSchedule(bad);
    expect(result.courses).toEqual([]);
    expect(result.warnings[0]).toMatch(/end time/i);
  });
});
