import { describe, expect, it } from 'vitest';
import { scoreSessionImportance } from './importance';
import { chunkResourceText } from './syllabus';

let counter = 0;
const makeId = () => `id-${counter++}`;

describe('scoreSessionImportance', () => {
  it('returns unknown when there is no syllabus or policy info', () => {
    const result = scoreSessionImportance({}, '2026-09-09', []);
    expect(result.level).toBe('unknown');
  });

  it('flags exam days as critical with a citation', () => {
    const chunks = chunkResourceText(
      {
        resourceId: 'r1',
        courseId: 'c1',
        sourceFilename: 'syllabus.txt',
        pages: [{ page: 1, text: '2026-09-09: Midterm exam in class.' }],
        defaultYear: 2026,
      },
      makeId,
    );
    const result = scoreSessionImportance({}, '2026-09-09', chunks);
    expect(result.level).toBe('critical');
    expect(result.citations[0].sourceFilename).toBe('syllabus.txt');
  });

  it('raises importance when attendance is graded per policy', () => {
    const result = scoreSessionImportance(
      { attendancePolicy: 'Attendance is 10% of your grade. No make-ups.' },
      '2026-09-09',
      [],
    );
    expect(result.level).not.toBe('unknown');
    expect(result.reasons.some((r) => /graded/i.test(r))).toBe(true);
  });
});
