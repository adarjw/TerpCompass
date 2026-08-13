import { describe, expect, it } from 'vitest';
import { parseScheduleText } from './scheduleText';

/**
 * The dropdown-expanded Testudo "my schedule" cards (each course expanded to
 * show title/instructor): component names appear as full words on their own
 * line, with days+time on the next line and the room right-aligned.
 */
const EXPANDED_OCR = `MATH 246 (0241) 3 cr
This section is face-to-face
Differential Equations for Scientists and Engineers
Lecture
TTh 11:00am - 12:15pm EST ARM 0135
Discussion
F 12:00pm - 12:50pm EST MTH 0101
Final
TBA

PHYS 260 (0506) 3 cr
This section is face-to-face
General Physics: Electricity, Magnetism and
Thermodynamics
Lecture
TTh 3:30pm - 4:45pm EST PHY 1412
Discussion
M 12:00pm - 12:50pm EST PHY 1204
Final
TBA

PHYS 261 (0201) 1 cr
This section is face-to-face
General Physics: Mechanics, Vibrations, Waves, Heat
(Laboratory)
Alexander Conte
Laboratory
M 9:00am - 11:20am EST PHY 3219
Final
TBA`;

describe('parseScheduleText on dropdown-expanded Testudo cards', () => {
  const result = parseScheduleText(EXPANDED_OCR);
  const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));

  it('parses all three courses with no partials', () => {
    expect(result.courses.map((c) => c.code).sort()).toEqual(['MATH246', 'PHYS260', 'PHYS261']);
    expect(result.partial).toEqual([]);
  });

  it('records meeting days and times from the line after the component word', () => {
    const lec = byCode['MATH246'].patterns.find((p) => p.label === 'lecture')!;
    expect(lec.meetingDays).toEqual([2, 4]);
    expect(lec.startTime).toBe('11:00');
    expect(lec.endTime).toBe('12:15');
    expect(lec.building).toBe('ARM');
    const dis = byCode['MATH246'].patterns.find((p) => p.label === 'discussion')!;
    expect(dis.meetingDays).toEqual([5]);
    expect(dis.startTime).toBe('12:00');
  });

  it('reads real course titles from the expanded card', () => {
    expect(byCode['MATH246'].name).toBe('Differential Equations for Scientists and Engineers');
  });

  it('handles the lab whose title mentions (Laboratory) without stealing the component row', () => {
    const lab = byCode['PHYS261'].patterns[0];
    expect(lab.label).toBe('lab');
    expect(lab.meetingDays).toEqual([1]);
    expect(lab.startTime).toBe('09:00');
    expect(lab.endTime).toBe('11:20');
    expect(lab.building).toBe('PHY');
    expect(lab.room).toBe('3219');
  });

  it('captures sections for all three', () => {
    expect(byCode['MATH246'].section).toBe('0241');
    expect(byCode['PHYS260'].section).toBe('0506');
    expect(byCode['PHYS261'].section).toBe('0201');
  });
});

describe('parseScheduleText column-read expanded cards', () => {
  it('pairs day+time rows with component words when OCR groups them separately', () => {
    // Tesseract sometimes reads the expanded card column-wise: every
    // component word first, then every time row, then the rooms.
    const columnOrdered = `MATH 246 (0241) 3 cr
This section is face-to-face
Differential Equations for Scientists and Engineers
Lecture
Discussion
Final
TTh 11:00am - 12:15pm EST
F 12:00pm - 12:50pm EST
TBA
ARM 0135
MTH 0101`;
    const result = parseScheduleText(columnOrdered);
    expect(result.partial).toEqual([]);
    const course = result.courses[0];
    expect(course.patterns).toHaveLength(2);
    const lec = course.patterns.find((p) => p.label === 'lecture')!;
    const dis = course.patterns.find((p) => p.label === 'discussion')!;
    expect(lec.meetingDays).toEqual([2, 4]);
    expect(lec.startTime).toBe('11:00');
    expect(lec.building).toBe('ARM');
    expect(lec.room).toBe('0135');
    expect(dis.meetingDays).toEqual([5]);
    expect(dis.startTime).toBe('12:00');
    expect(dis.building).toBe('MTH');
    expect(dis.room).toBe('0101');
  });
});
