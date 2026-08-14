/**
 * JSON backup/restore. Exports every table into one versioned document;
 * import validates structure before any write and reports problems rather
 * than importing garbage. Restores are additive-by-replacement: the caller
 * decides whether to wipe first.
 */

import { parseISODate, parseTime } from './time';
import type {
  Absence,
  CampusLocation,
  CatchUpPlan,
  CatchUpTask,
  ClassSession,
  Course,
  MeetingPattern,
  Resource,
  ResourceChunk,
  Weekday,
} from './types';

export const BACKUP_VERSION = 2;

/** Legacy app id, from before the app was renamed to ClassCompass — still accepted on restore. */
const LEGACY_APP_ID = 'terrapin-class-compass';
const APP_ID = 'class-compass';

export interface BackupDocument {
  app: typeof APP_ID | typeof LEGACY_APP_ID;
  version: number;
  exportedAt: string;
  courses: Course[];
  patterns: MeetingPattern[];
  sessions: ClassSession[];
  absences: Absence[];
  resources: Resource[];
  chunks: ResourceChunk[];
  plans: CatchUpPlan[];
  tasks: CatchUpTask[];
  locations: CampusLocation[];
  settings: Record<string, unknown>;
}

export function buildBackup(data: Omit<BackupDocument, 'app' | 'version' | 'exportedAt'>): string {
  const doc: BackupDocument = {
    app: APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(doc, null, 2);
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  doc: BackupDocument | null;
}

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

const VALID_STATUS = new Set(['scheduled', 'attended', 'absent', 'canceled', 'moved']);

export function validateBackup(jsonText: string): BackupValidation {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, errors: ['File is not valid JSON.'], doc: null };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, errors: ['Backup must be a JSON object.'], doc: null };
  }
  const o = parsed as Record<string, unknown>;
  if (o.app !== APP_ID && o.app !== LEGACY_APP_ID) {
    errors.push('This JSON was not exported by ClassCompass.');
  }
  if (typeof o.version !== 'number' || o.version > BACKUP_VERSION) {
    errors.push(`Unsupported backup version: ${String(o.version)}.`);
  } else if (o.version < BACKUP_VERSION) {
    errors.push(
      `Backup was made with an older app version (v${String(o.version)}) that used a different schedule format. Re-export it with the current app version.`,
    );
  }
  for (const key of [
    'courses',
    'patterns',
    'sessions',
    'absences',
    'resources',
    'chunks',
    'plans',
    'tasks',
    'locations',
  ]) {
    if (!isArr(o[key])) errors.push(`Missing or invalid "${key}" list.`);
  }
  if (errors.length > 0) return { ok: false, errors, doc: null };

  // Structural spot-checks on the rows that drive scheduling.
  const courses = o.courses as Course[];
  for (const c of courses) {
    if (typeof c?.id !== 'string' || typeof c?.code !== 'string') {
      errors.push('A course row is missing id/code.');
      break;
    }
    if (!parseISODate(c.semesterStart) || !parseISODate(c.semesterEnd)) {
      errors.push(`Course ${c.code}: invalid semester dates.`);
    }
  }
  const courseIds = new Set(courses.map((c) => c.id));

  const patterns = o.patterns as MeetingPattern[];
  const patternIds = new Set<string>();
  for (const p of patterns) {
    if (typeof p?.id !== 'string' || !courseIds.has(p.courseId)) {
      errors.push('A meeting-pattern row references a missing course.');
      break;
    }
    if (parseTime(p.startTime) == null || parseTime(p.endTime) == null) {
      errors.push(`Meeting pattern for course ${p.courseId}: invalid start/end time.`);
    }
    if (
      !Array.isArray(p.meetingDays) ||
      p.meetingDays.some((d: Weekday) => typeof d !== 'number' || d < 0 || d > 6)
    ) {
      errors.push(`Meeting pattern for course ${p.courseId}: invalid meeting days.`);
    }
    patternIds.add(p.id);
  }
  const coursesWithoutPatterns = courses.filter(
    (c) => !patterns.some((p) => p.courseId === c.id),
  );
  if (coursesWithoutPatterns.length > 0) {
    errors.push(
      `Course(s) with no meeting pattern: ${coursesWithoutPatterns.map((c) => c.code).join(', ')}.`,
    );
  }

  const sessions = o.sessions as ClassSession[];
  for (const s of sessions) {
    if (typeof s?.id !== 'string' || !courseIds.has(s.courseId)) {
      errors.push('A session row references a missing course.');
      break;
    }
    if (!parseISODate(s.date) || !VALID_STATUS.has(s.status)) {
      errors.push(`Session on ${s.date}: invalid date or status.`);
      break;
    }
  }

  if (errors.length > 0) return { ok: false, errors, doc: null };
  return { ok: true, errors: [], doc: o as unknown as BackupDocument };
}
