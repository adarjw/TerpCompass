import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics';

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:CMSC216 Intro to Computer Systems
LOCATION:IRB 0324
DTSTART:20260831T100000
DTEND:20260831T105000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261214T235900Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:CMSC216 Midterm Exam
LOCATION:IRB 0324
DTSTART:20261015T100000
DTEND:20261015T115000
END:VEVENT
END:VCALENDAR`;

describe('parseIcs', () => {
  it('extracts a recurring weekly course', () => {
    const result = parseIcs(SAMPLE_ICS);
    expect(result.courses).toHaveLength(1);
    const c = result.courses[0];
    expect(c.code).toBe('CMSC216');
    expect(c.patterns).toHaveLength(1);
    const p = c.patterns[0];
    expect(p.meetingDays.sort()).toEqual([1, 3, 5]);
    expect(p.startTime).toBe('10:00');
    expect(p.endTime).toBe('10:50');
    expect(p.building).toBe('IRB');
    expect(p.room).toBe('0324');
    expect(c.semesterStart).toBe('2026-08-31');
  });

  it('merges a lecture and discussion VEVENT sharing the same code', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:MATH246 Lec
LOCATION:MTH 0102
DTSTART:20260901T110000
DTEND:20260901T121500
RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261214T235900Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:MATH246 Dis
LOCATION:MTH 0101
DTSTART:20260904T120000
DTEND:20260904T125000
RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261214T235900Z
END:VEVENT
END:VCALENDAR`;
    const result = parseIcs(ics);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].patterns).toHaveLength(2);
    expect(result.courses[0].patterns.map((p) => p.label).sort()).toEqual(['discussion', 'lecture']);
  });

  it('extracts one-off events as exam/deadline candidates', () => {
    const result = parseIcs(SAMPLE_ICS);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('exam');
    expect(result.events[0].date).toBe('2026-10-15');
  });

  it('rejects non-calendar text without guessing', () => {
    const result = parseIcs('not a calendar');
    expect(result.courses).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
