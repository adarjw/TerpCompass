import { describe, expect, it } from 'vitest';
import { buildBackup, validateBackup } from './backup';

const baseData = {
  courses: [],
  patterns: [],
  sessions: [],
  absences: [],
  resources: [],
  chunks: [],
  plans: [],
  tasks: [],
  locations: [],
  settings: {},
};

describe('backup validate/build round trip', () => {
  it('accepts a document it just built', () => {
    const json = buildBackup(baseData);
    const result = validateBackup(json);
    expect(result.ok).toBe(true);
  });

  it('rejects non-JSON input', () => {
    const result = validateBackup('not json{{{');
    expect(result.ok).toBe(false);
  });

  it('rejects a backup from a different app', () => {
    const json = JSON.stringify({ app: 'other-app', version: 2, ...baseData });
    const result = validateBackup(json);
    expect(result.ok).toBe(false);
  });

  it('rejects a backup made with an older, incompatible version', () => {
    const json = JSON.stringify({ app: 'terrapin-class-compass', version: 1, ...baseData });
    const result = validateBackup(json);
    expect(result.ok).toBe(false);
  });

  it('rejects a course row with an invalid semester date', () => {
    const doc = {
      app: 'terrapin-class-compass',
      version: 2,
      ...baseData,
      courses: [
        {
          id: 'c1', code: 'CMSC216', name: 'x', professor: '',
          semesterStart: 'not-a-date', semesterEnd: '2026-12-14', createdAt: '',
        },
      ],
      patterns: [
        {
          id: 'p1', courseId: 'c1', label: 'lecture', building: '', room: '',
          meetingDays: [1], startTime: '10:00', endTime: '10:50',
        },
      ],
    };
    const result = validateBackup(JSON.stringify(doc));
    expect(result.ok).toBe(false);
  });

  it('rejects a course that has no meeting pattern at all', () => {
    const doc = {
      app: 'terrapin-class-compass',
      version: 2,
      ...baseData,
      courses: [
        { id: 'c1', code: 'CMSC216', name: 'x', professor: '', semesterStart: '2026-08-31', semesterEnd: '2026-12-14', createdAt: '' },
      ],
    };
    const result = validateBackup(JSON.stringify(doc));
    expect(result.ok).toBe(false);
  });
});
