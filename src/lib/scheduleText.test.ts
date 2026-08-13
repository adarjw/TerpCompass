import { describe, expect, it } from 'vitest';
import { parseScheduleText } from './scheduleText';

/**
 * Simulated OCR output for a real Testudo "my schedule" screenshot:
 * six courses, TTh/MW/single-day rows, EST suffixes, Final TBA rows.
 */
const TESTUDO_OCR = `COMM 107 (9601)
This section is face-to-face
Lec TTh 12:30pm - 1:45pm EST SKN 1112
Final TBA

ENES 221 (0103)
This section is face-to-face
Lec MW 1:00pm - 1:50pm EST ATL 1113
Dis F 1:00pm - 2:50pm EST EGR 1202
Final TBA

ENME 272 (0601)
This section is face-to-face
Lec W 3:00pm - 4:50pm EST KEB 2111
Final TBA

MATH 246 (0241)
This section is face-to-face
Lec TTh 11:00am - 12:15pm EST ARM 0135
Dis F 12:00pm - 12:50pm EST MTH 0101
Final TBA

PHYS 260 (0506)
This section is face-to-face
Lec TTh 3:30pm - 4:45pm EST PHY 1412
Dis M 12:00pm - 12:50pm EST PHY 1204
Final TBA

PHYS 261 (0201)
This section is face-to-face
Lab M 9:00am - 11:20am EST PHY 3219
Final TBA`;

describe('parseScheduleText on a full Testudo schedule', () => {
  const result = parseScheduleText(TESTUDO_OCR);
  const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));

  it('parses all six courses with nothing left for manual entry', () => {
    expect(result.partial).toEqual([]);
    expect(result.courses.map((c) => c.code).sort()).toEqual([
      'COMM107', 'ENES221', 'ENME272', 'MATH246', 'PHYS260', 'PHYS261',
    ]);
  });

  it('reads TTh as Tuesday+Thursday', () => {
    expect(byCode['COMM107'].patterns[0].meetingDays).toEqual([2, 4]);
    expect(byCode['COMM107'].patterns[0].startTime).toBe('12:30');
    expect(byCode['COMM107'].patterns[0].endTime).toBe('13:45');
    expect(byCode['COMM107'].patterns[0].building).toBe('SKN');
    expect(byCode['COMM107'].patterns[0].room).toBe('1112');
  });

  it('keeps lecture and discussion as separate patterns', () => {
    const enes = byCode['ENES221'];
    expect(enes.patterns).toHaveLength(2);
    const lec = enes.patterns.find((p) => p.label === 'lecture')!;
    const dis = enes.patterns.find((p) => p.label === 'discussion')!;
    expect(lec.meetingDays).toEqual([1, 3]); // MW
    expect(lec.building).toBe('ATL');
    expect(dis.meetingDays).toEqual([5]); // F
    expect(dis.building).toBe('EGR');
    expect(dis.startTime).toBe('13:00');
    expect(dis.endTime).toBe('14:50');
  });

  it('handles single-day rows (W lecture, M lab)', () => {
    expect(byCode['ENME272'].patterns[0].meetingDays).toEqual([3]);
    expect(byCode['ENME272'].patterns[0].startTime).toBe('15:00');
    const lab = byCode['PHYS261'].patterns[0];
    expect(lab.label).toBe('lab');
    expect(lab.meetingDays).toEqual([1]);
    expect(lab.startTime).toBe('09:00');
    expect(lab.endTime).toBe('11:20');
  });

  it('handles am→pm ranges crossing noon', () => {
    const lec = byCode['MATH246'].patterns.find((p) => p.label === 'lecture')!;
    expect(lec.startTime).toBe('11:00');
    expect(lec.endTime).toBe('12:15');
  });

  it('skips Final TBA rows entirely', () => {
    for (const course of result.courses) {
      expect(course.patterns.every((p) => p.startTime !== '')).toBe(true);
    }
    expect(byCode['COMM107'].patterns).toHaveLength(1);
  });
});

describe('parseScheduleText section and instructor capture', () => {
  it('captures the Testudo section number from the code line', () => {
    const result = parseScheduleText(TESTUDO_OCR);
    const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));
    expect(byCode['PHYS260'].section).toBe('0506');
    expect(byCode['COMM107'].section).toBe('9601');
  });

  it('reads an explicit Instructor line into professor, skipping TBA', () => {
    const withInstructor = `PHYS 260 (0506)
Instructor: Hailu Gebremariam
Lec TTh 3:30pm - 4:45pm EST PHY 1412
Final TBA

COMM 107 (9601)
Instructor: TBA
Lec TTh 12:30pm - 1:45pm EST SKN 1112`;
    const result = parseScheduleText(withInstructor);
    const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));
    expect(byCode['PHYS260'].professor).toBe('Hailu Gebremariam');
    expect(byCode['COMM107'].professor).toBe('');
    // The instructor line must not be mistaken for the course name.
    expect(byCode['PHYS260'].name).toBe('PHYS260');
  });
});

describe('parseScheduleText OCR-noise tolerance', () => {
  it('repairs letter-O-for-zero inside times and strips table artifacts', () => {
    const noisy = `PHYS 260 (0506)
Lec TTh 3:3Opm - 4:45pm EST | PHY 1412
Final TBA`;
    const result = parseScheduleText(noisy);
    expect(result.partial).toEqual([]);
    expect(result.courses[0].patterns[0].startTime).toBe('15:30');
    expect(result.courses[0].patterns[0].building).toBe('PHY');
  });

  it('still reports genuinely unreadable blocks as partial instead of guessing', () => {
    const garbage = `CMSC216 (0101)
Lec ??? garbled ###`;
    const result = parseScheduleText(garbage);
    expect(result.courses).toEqual([]);
    expect(result.partial).toHaveLength(1);
  });

  it('recovers a room OCR placed after the Final row (right-aligned column read)', () => {
    // Testudo right-aligns room links; column-wise OCR can emit them on
    // their own line after "Final TBA" — the PHYS261 bug.
    const columnOrdered = `PHYS 261 (0201)
This section is face-to-face
Lab M 9:00am - 11:20am EST
Final TBA
PHY 3219`;
    const result = parseScheduleText(columnOrdered);
    expect(result.partial).toEqual([]);
    const lab = result.courses[0].patterns[0];
    expect(lab.label).toBe('lab');
    expect(lab.building).toBe('PHY');
    expect(lab.room).toBe('3219');
  });

  it('assigns column-read rooms to multiple components in order', () => {
    const columnOrdered = `ENES 221 (0103)
Lec MW 1:00pm - 1:50pm EST
Dis F 1:00pm - 2:50pm EST
Final TBA
ATL 1113
EGR 1202`;
    const result = parseScheduleText(columnOrdered);
    const lec = result.courses[0].patterns.find((p) => p.label === 'lecture')!;
    const dis = result.courses[0].patterns.find((p) => p.label === 'discussion')!;
    expect(lec.building).toBe('ATL');
    expect(lec.room).toBe('1113');
    expect(dis.building).toBe('EGR');
    expect(dis.room).toBe('1202');
  });

  it('does not steal an inline room to fill a different component', () => {
    // Dis has its room inline; Lec's room floated to the end. The floated
    // token must go to Lec, not double-assign the Dis room.
    const mixed = `MATH 246 (0241)
Lec TTh 11:00am - 12:15pm EST
Dis F 12:00pm - 12:50pm EST MTH 0101
Final TBA
ARM 0135`;
    const result = parseScheduleText(mixed);
    const lec = result.courses[0].patterns.find((p) => p.label === 'lecture')!;
    const dis = result.courses[0].patterns.find((p) => p.label === 'discussion')!;
    expect(dis.building).toBe('MTH');
    expect(dis.room).toBe('0101');
    expect(lec.building).toBe('ARM');
    expect(lec.room).toBe('0135');
  });
});
