/**
 * Repositories: typed CRUD over the SqlExecutor. Row mapping is centralized
 * here so screens never touch SQL.
 */

import type { CalendarEventDraft } from '../lib/ics';
import { makeId } from '../lib/ids';
import type {
  Absence,
  AppSettings,
  CampusLocation,
  CatchUpPlan,
  CatchUpTask,
  ClassNote,
  ClassSession,
  Course,
  MeetingComponent,
  MeetingPattern,
  Resource,
  ResourceChunk,
  ScheduledNotificationRecord,
  SessionStatus,
  Weekday,
  WalkRecording,
  WalkStartPoint,
} from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { SqlExecutor, SqlRow } from './database';

// ---------- helpers ----------

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function strOrU(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

// ---------- courses ----------

function rowToCourse(r: SqlRow): Course {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    professor: str(r.professor),
    professorEmail: strOrU(r.professor_email),
    taEmails: strOrU(r.ta_emails),
    semesterStart: str(r.semester_start),
    semesterEnd: str(r.semester_end),
    attendancePolicy: strOrU(r.attendance_policy),
    walkingBufferMin: num(r.walking_buffer_min) ?? undefined,
    color: strOrU(r.color),
    createdAt: str(r.created_at),
  };
}

export const coursesRepo = {
  async all(db: SqlExecutor): Promise<Course[]> {
    const rows = await db.getAllAsync(`SELECT * FROM courses ORDER BY code`);
    return rows.map(rowToCourse);
  },
  async byId(db: SqlExecutor, id: string): Promise<Course | null> {
    const r = await db.getFirstAsync(`SELECT * FROM courses WHERE id = ?`, [id]);
    return r ? rowToCourse(r) : null;
  },
  async upsert(db: SqlExecutor, c: Course): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO courses
       (id, code, name, professor, professor_email, ta_emails, semester_start, semester_end,
        attendance_policy, walking_buffer_min, color, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        c.id, c.code, c.name, c.professor, c.professorEmail ?? null, c.taEmails ?? null,
        c.semesterStart, c.semesterEnd, c.attendancePolicy ?? null,
        c.walkingBufferMin ?? null, c.color ?? null, c.createdAt,
      ],
    );
  },
  async remove(db: SqlExecutor, id: string): Promise<void> {
    // Cascades handle children, but delete explicitly for older SQLite configs.
    for (const table of [
      'notifications',
      'catch_up_tasks',
      'catch_up_plans',
      'extracted_resource_chunks',
      'resources',
      'absences',
      'class_sessions',
      'meeting_patterns',
    ]) {
      if (table === 'notifications') {
        await db.runAsync(
          `DELETE FROM notifications WHERE session_id IN (SELECT id FROM class_sessions WHERE course_id = ?)`,
          [id],
        );
      } else {
        await db.runAsync(`DELETE FROM ${table} WHERE course_id = ?`, [id]);
      }
    }
    await db.runAsync(`DELETE FROM courses WHERE id = ?`, [id]);
  },
};

// ---------- meeting patterns ----------

function rowToPattern(r: SqlRow): MeetingPattern {
  let days: Weekday[] = [];
  try {
    const parsed = JSON.parse(str(r.meeting_days));
    if (Array.isArray(parsed)) days = parsed.filter((d) => d >= 0 && d <= 6);
  } catch {
    days = [];
  }
  return {
    id: str(r.id),
    courseId: str(r.course_id),
    label: str(r.label) as MeetingComponent,
    building: str(r.building),
    room: str(r.room),
    meetingDays: days,
    startTime: str(r.start_time),
    endTime: str(r.end_time),
  };
}

export const patternsRepo = {
  async forCourse(db: SqlExecutor, courseId: string): Promise<MeetingPattern[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM meeting_patterns WHERE course_id = ? ORDER BY start_time`,
      [courseId],
    );
    return rows.map(rowToPattern);
  },
  async all(db: SqlExecutor): Promise<MeetingPattern[]> {
    const rows = await db.getAllAsync(`SELECT * FROM meeting_patterns`);
    return rows.map(rowToPattern);
  },
  async insertMany(db: SqlExecutor, patterns: MeetingPattern[]): Promise<void> {
    for (const p of patterns) {
      await db.runAsync(
        `INSERT OR REPLACE INTO meeting_patterns
         (id, course_id, label, building, room, meeting_days, start_time, end_time)
         VALUES (?,?,?,?,?,?,?,?)`,
        [p.id, p.courseId, p.label, p.building, p.room, JSON.stringify(p.meetingDays), p.startTime, p.endTime],
      );
    }
  },
  /** Replace every pattern for a course with a fresh set (used when editing a course). */
  async replaceForCourse(db: SqlExecutor, courseId: string, patterns: MeetingPattern[]): Promise<void> {
    await db.runAsync(`DELETE FROM meeting_patterns WHERE course_id = ?`, [courseId]);
    await this.insertMany(db, patterns);
  },
};

// ---------- class sessions ----------

function rowToSession(r: SqlRow): ClassSession {
  return {
    id: str(r.id),
    courseId: str(r.course_id),
    patternId: str(r.pattern_id),
    patternLabel: str(r.pattern_label) as MeetingComponent,
    date: str(r.date),
    startTime: str(r.start_time),
    endTime: str(r.end_time),
    building: str(r.building),
    room: str(r.room),
    status: str(r.status) as SessionStatus,
    changeNote: strOrU(r.change_note),
    overrideBuilding: strOrU(r.override_building),
    overrideRoom: strOrU(r.override_room),
  };
}

export const sessionsRepo = {
  async all(db: SqlExecutor): Promise<ClassSession[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM class_sessions ORDER BY date, start_time`,
    );
    return rows.map(rowToSession);
  },
  async byId(db: SqlExecutor, id: string): Promise<ClassSession | null> {
    const r = await db.getFirstAsync(`SELECT * FROM class_sessions WHERE id = ?`, [id]);
    return r ? rowToSession(r) : null;
  },
  async forCourse(db: SqlExecutor, courseId: string): Promise<ClassSession[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM class_sessions WHERE course_id = ? ORDER BY date, start_time`,
      [courseId],
    );
    return rows.map(rowToSession);
  },
  async insertMany(db: SqlExecutor, sessions: ClassSession[]): Promise<void> {
    for (const s of sessions) {
      await db.runAsync(
        `INSERT OR REPLACE INTO class_sessions
         (id, course_id, pattern_id, pattern_label, date, start_time, end_time, building, room,
          status, change_note, override_building, override_room)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          s.id, s.courseId, s.patternId, s.patternLabel, s.date, s.startTime, s.endTime,
          s.building, s.room, s.status,
          s.changeNote ?? null, s.overrideBuilding ?? null, s.overrideRoom ?? null,
        ],
      );
    }
  },
  async setStatus(
    db: SqlExecutor,
    id: string,
    status: SessionStatus,
    changeNote?: string,
    overrideBuilding?: string,
    overrideRoom?: string,
  ): Promise<void> {
    await db.runAsync(
      `UPDATE class_sessions SET status = ?, change_note = ?, override_building = ?, override_room = ? WHERE id = ?`,
      [status, changeNote ?? null, overrideBuilding ?? null, overrideRoom ?? null, id],
    );
  },
  /**
   * Regenerate sessions for a course after its meeting patterns changed,
   * preserving any session that already has history (attended/absent/
   * canceled/moved).
   */
  async regenerate(
    db: SqlExecutor,
    courseId: string,
    fresh: ClassSession[],
  ): Promise<void> {
    // Keyed by date+time (not patternId): editing a course replaces every
    // pattern with fresh ids, so patternId can't be used to match old
    // history rows back to newly generated sessions.
    const existing = await this.forCourse(db, courseId);
    const keep = new Set(
      existing.filter((s) => s.status !== 'scheduled').map((s) => `${s.date}|${s.startTime}`),
    );
    await db.runAsync(
      `DELETE FROM class_sessions WHERE course_id = ? AND status = 'scheduled'`,
      [courseId],
    );
    const toInsert = fresh.filter((s) => !keep.has(`${s.date}|${s.startTime}`));
    await this.insertMany(db, toInsert);
  },
};

// ---------- absences ----------

function rowToAbsence(r: SqlRow): Absence {
  return {
    id: str(r.id),
    sessionId: str(r.session_id),
    courseId: str(r.course_id),
    date: str(r.date),
    reason: strOrU(r.reason),
    recordedAt: str(r.recorded_at),
    catchUpPlanId: strOrU(r.catch_up_plan_id),
  };
}

export const absencesRepo = {
  async all(db: SqlExecutor): Promise<Absence[]> {
    const rows = await db.getAllAsync(`SELECT * FROM absences ORDER BY date DESC`);
    return rows.map(rowToAbsence);
  },
  async forCourse(db: SqlExecutor, courseId: string): Promise<Absence[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM absences WHERE course_id = ? ORDER BY date DESC`,
      [courseId],
    );
    return rows.map(rowToAbsence);
  },
  async insert(db: SqlExecutor, a: Absence): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO absences (id, session_id, course_id, date, reason, recorded_at, catch_up_plan_id)
       VALUES (?,?,?,?,?,?,?)`,
      [a.id, a.sessionId, a.courseId, a.date, a.reason ?? null, a.recordedAt, a.catchUpPlanId ?? null],
    );
  },
  async linkPlan(db: SqlExecutor, absenceId: string, planId: string): Promise<void> {
    await db.runAsync(`UPDATE absences SET catch_up_plan_id = ? WHERE id = ?`, [
      planId,
      absenceId,
    ]);
  },
  async remove(db: SqlExecutor, id: string): Promise<void> {
    await db.runAsync(`DELETE FROM absences WHERE id = ?`, [id]);
  },
};

// ---------- resources & chunks ----------

function rowToResource(r: SqlRow): Resource {
  return {
    id: str(r.id),
    courseId: str(r.course_id),
    kind: str(r.kind) as Resource['kind'],
    title: str(r.title),
    fileUri: strOrU(r.file_uri),
    originalFilename: strOrU(r.original_filename),
    url: strOrU(r.url),
    addedAt: str(r.added_at),
    extractionStatus: str(r.extraction_status) as Resource['extractionStatus'],
    extractionError: strOrU(r.extraction_error),
  };
}

export const resourcesRepo = {
  async forCourse(db: SqlExecutor, courseId: string): Promise<Resource[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM resources WHERE course_id = ? ORDER BY added_at DESC`,
      [courseId],
    );
    return rows.map(rowToResource);
  },
  async all(db: SqlExecutor): Promise<Resource[]> {
    const rows = await db.getAllAsync(`SELECT * FROM resources`);
    return rows.map(rowToResource);
  },
  async insert(db: SqlExecutor, res: Resource): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO resources
       (id, course_id, kind, title, file_uri, original_filename, url, added_at, extraction_status, extraction_error)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        res.id, res.courseId, res.kind, res.title, res.fileUri ?? null,
        res.originalFilename ?? null, res.url ?? null, res.addedAt,
        res.extractionStatus, res.extractionError ?? null,
      ],
    );
  },
  async remove(db: SqlExecutor, id: string): Promise<void> {
    await db.runAsync(`DELETE FROM extracted_resource_chunks WHERE resource_id = ?`, [id]);
    await db.runAsync(`DELETE FROM resources WHERE id = ?`, [id]);
  },
};

function rowToChunk(r: SqlRow): ResourceChunk {
  return {
    id: str(r.id),
    resourceId: str(r.resource_id),
    courseId: str(r.course_id),
    sourceFilename: str(r.source_filename),
    page: num(r.page),
    text: str(r.text),
    detectedDate: strOrU(r.detected_date) ?? null,
    detectedTopic: strOrU(r.detected_topic) ?? null,
    ordinal: num(r.ordinal) ?? 0,
  };
}

export const chunksRepo = {
  async forCourse(db: SqlExecutor, courseId: string): Promise<ResourceChunk[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM extracted_resource_chunks WHERE course_id = ? ORDER BY ordinal`,
      [courseId],
    );
    return rows.map(rowToChunk);
  },
  async all(db: SqlExecutor): Promise<ResourceChunk[]> {
    const rows = await db.getAllAsync(`SELECT * FROM extracted_resource_chunks`);
    return rows.map(rowToChunk);
  },
  async insertMany(db: SqlExecutor, chunks: ResourceChunk[]): Promise<void> {
    for (const c of chunks) {
      await db.runAsync(
        `INSERT OR REPLACE INTO extracted_resource_chunks
         (id, resource_id, course_id, source_filename, page, text, detected_date, detected_topic, ordinal)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          c.id, c.resourceId, c.courseId, c.sourceFilename, c.page, c.text,
          c.detectedDate, c.detectedTopic, c.ordinal,
        ],
      );
    }
  },
};

// ---------- catch-up plans & tasks ----------

interface PlanPayload {
  requiredReadings: CatchUpPlan['requiredReadings'];
  relevantFiles: CatchUpPlan['relevantFiles'];
  problems: CatchUpPlan['problems'];
  prerequisites: string[];
  estimatedMinutes: number | null;
  minimumViable: string[];
  deeperVersion: string[];
  quiz: CatchUpPlan['quiz'];
}

function rowToPlan(r: SqlRow): CatchUpPlan {
  let payload: PlanPayload;
  try {
    payload = JSON.parse(str(r.payload));
  } catch {
    payload = {
      requiredReadings: [], relevantFiles: [], problems: [], prerequisites: [],
      estimatedMinutes: null, minimumViable: [], deeperVersion: [], quiz: [],
    };
  }
  return {
    id: str(r.id),
    absenceId: str(r.absence_id),
    courseId: str(r.course_id),
    sessionDate: str(r.session_date),
    createdAt: str(r.created_at),
    generatedBy: str(r.generated_by) as CatchUpPlan['generatedBy'],
    aiGenerated: r.ai_generated === 1,
    likelyTopic: strOrU(r.likely_topic) ?? null,
    confidence: str(r.confidence) as CatchUpPlan['confidence'],
    notice: strOrU(r.notice),
    userNotes: strOrU(r.user_notes),
    ...payload,
  };
}

export const plansRepo = {
  async all(db: SqlExecutor): Promise<CatchUpPlan[]> {
    const rows = await db.getAllAsync(`SELECT * FROM catch_up_plans ORDER BY created_at DESC`);
    return rows.map(rowToPlan);
  },
  async byId(db: SqlExecutor, id: string): Promise<CatchUpPlan | null> {
    const r = await db.getFirstAsync(`SELECT * FROM catch_up_plans WHERE id = ?`, [id]);
    return r ? rowToPlan(r) : null;
  },
  async forCourse(db: SqlExecutor, courseId: string): Promise<CatchUpPlan[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM catch_up_plans WHERE course_id = ? ORDER BY created_at DESC`,
      [courseId],
    );
    return rows.map(rowToPlan);
  },
  async save(db: SqlExecutor, p: CatchUpPlan): Promise<void> {
    const payload: PlanPayload = {
      requiredReadings: p.requiredReadings,
      relevantFiles: p.relevantFiles,
      problems: p.problems,
      prerequisites: p.prerequisites,
      estimatedMinutes: p.estimatedMinutes,
      minimumViable: p.minimumViable,
      deeperVersion: p.deeperVersion,
      quiz: p.quiz,
    };
    await db.runAsync(
      `INSERT OR REPLACE INTO catch_up_plans
       (id, absence_id, course_id, session_date, created_at, generated_by, ai_generated,
        likely_topic, confidence, notice, payload, user_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        p.id, p.absenceId, p.courseId, p.sessionDate, p.createdAt, p.generatedBy,
        p.aiGenerated ? 1 : 0, p.likelyTopic, p.confidence, p.notice ?? null,
        JSON.stringify(payload), p.userNotes ?? null,
      ],
    );
  },
  async remove(db: SqlExecutor, id: string): Promise<void> {
    await db.runAsync(`DELETE FROM catch_up_tasks WHERE plan_id = ?`, [id]);
    await db.runAsync(`DELETE FROM catch_up_plans WHERE id = ?`, [id]);
  },
};

function rowToTask(r: SqlRow): CatchUpTask {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    courseId: str(r.course_id),
    title: str(r.title),
    dueDate: strOrU(r.due_date) ?? null,
    done: r.done === 1,
    createdAt: str(r.created_at),
  };
}

export const tasksRepo = {
  async all(db: SqlExecutor): Promise<CatchUpTask[]> {
    const rows = await db.getAllAsync(`SELECT * FROM catch_up_tasks ORDER BY created_at`);
    return rows.map(rowToTask);
  },
  async forPlan(db: SqlExecutor, planId: string): Promise<CatchUpTask[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM catch_up_tasks WHERE plan_id = ? ORDER BY created_at`,
      [planId],
    );
    return rows.map(rowToTask);
  },
  async insert(db: SqlExecutor, t: CatchUpTask): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO catch_up_tasks (id, plan_id, course_id, title, due_date, done, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [t.id, t.planId, t.courseId, t.title, t.dueDate, t.done ? 1 : 0, t.createdAt],
    );
  },
  async setDone(db: SqlExecutor, id: string, done: boolean): Promise<void> {
    await db.runAsync(`UPDATE catch_up_tasks SET done = ? WHERE id = ?`, [done ? 1 : 0, id]);
  },
};

// ---------- notifications ----------

export const notificationsRepo = {
  async all(db: SqlExecutor): Promise<ScheduledNotificationRecord[]> {
    const rows = await db.getAllAsync(`SELECT * FROM notifications ORDER BY fire_at`);
    return rows.map((r) => ({
      id: str(r.id),
      osNotificationId: str(r.os_notification_id),
      sessionId: strOrU(r.session_id) ?? null,
      kind: str(r.kind) as ScheduledNotificationRecord['kind'],
      fireAt: str(r.fire_at),
    }));
  },
  async replaceAll(
    db: SqlExecutor,
    records: ScheduledNotificationRecord[],
  ): Promise<void> {
    await db.runAsync(`DELETE FROM notifications`);
    for (const n of records) {
      await db.runAsync(
        `INSERT INTO notifications (id, os_notification_id, session_id, kind, fire_at) VALUES (?,?,?,?,?)`,
        [n.id, n.osNotificationId, n.sessionId, n.kind, n.fireAt],
      );
    }
  },
};

// ---------- campus locations ----------

function rowToLocation(r: SqlRow): CampusLocation {
  return {
    id: str(r.id),
    name: str(r.name),
    abbreviation: str(r.abbreviation),
    lat: num(r.lat),
    lon: num(r.lon),
    entranceNotes: strOrU(r.entrance_notes),
    roomNotes: strOrU(r.room_notes),
    walkOverrideMin: num(r.walk_override_min) ?? undefined,
  };
}

export const locationsRepo = {
  async all(db: SqlExecutor): Promise<CampusLocation[]> {
    const rows = await db.getAllAsync(`SELECT * FROM campus_locations ORDER BY name`);
    return rows.map(rowToLocation);
  },
  async upsert(db: SqlExecutor, loc: CampusLocation): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO campus_locations
       (id, name, abbreviation, lat, lon, entrance_notes, room_notes, walk_override_min)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        loc.id, loc.name, loc.abbreviation, loc.lat, loc.lon,
        loc.entranceNotes ?? null, loc.roomNotes ?? null, loc.walkOverrideMin ?? null,
      ],
    );
  },
  async remove(db: SqlExecutor, id: string): Promise<void> {
    await db.runAsync(`DELETE FROM campus_locations WHERE id = ?`, [id]);
  },
};

// ---------- calendar events (exams/deadlines from .ics) ----------

export interface CalendarEvent extends CalendarEventDraft {
  id: string;
}

export const eventsRepo = {
  async all(db: SqlExecutor): Promise<CalendarEvent[]> {
    const rows = await db.getAllAsync(`SELECT * FROM calendar_events ORDER BY date`);
    return rows.map((r) => ({
      id: str(r.id),
      title: str(r.title),
      date: str(r.date),
      time: strOrU(r.time) ?? null,
      kind: str(r.kind) as CalendarEvent['kind'],
    }));
  },
  async insertMany(db: SqlExecutor, events: CalendarEventDraft[]): Promise<void> {
    for (const e of events) {
      await db.runAsync(
        `INSERT INTO calendar_events (id, title, date, time, kind) VALUES (?,?,?,?,?)`,
        [makeId(), e.title, e.date, e.time, e.kind],
      );
    }
  },
};

// ---------- class notes ----------

function rowToNote(r: SqlRow): ClassNote {
  return {
    id: str(r.id),
    sessionId: str(r.session_id),
    courseId: str(r.course_id),
    timestamp: str(r.timestamp),
    text: str(r.text),
    createdAt: str(r.created_at),
  };
}

export const notesRepo = {
  async forSession(db: SqlExecutor, sessionId: string): Promise<ClassNote[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM class_notes WHERE session_id = ? ORDER BY created_at`,
      [sessionId],
    );
    return rows.map(rowToNote);
  },
  async forCourse(db: SqlExecutor, courseId: string): Promise<ClassNote[]> {
    const rows = await db.getAllAsync(
      `SELECT * FROM class_notes WHERE course_id = ? ORDER BY created_at`,
      [courseId],
    );
    return rows.map(rowToNote);
  },
  async insert(db: SqlExecutor, n: ClassNote): Promise<void> {
    await db.runAsync(
      `INSERT INTO class_notes (id, session_id, course_id, timestamp, text, created_at) VALUES (?,?,?,?,?,?)`,
      [n.id, n.sessionId, n.courseId, n.timestamp, n.text, n.createdAt],
    );
  },
  async remove(db: SqlExecutor, id: string): Promise<void> {
    await db.runAsync(`DELETE FROM class_notes WHERE id = ?`, [id]);
  },
};

// ---------- walk recordings ----------

function rowToWalkRecording(r: SqlRow): WalkRecording {
  return {
    id: str(r.id),
    fromLabel: str(r.from_label) as WalkStartPoint,
    fromOtherText: strOrU(r.from_other_text),
    toBuilding: str(r.to_building),
    minutes: num(r.minutes) ?? 0,
    recordedAt: str(r.recorded_at),
  };
}

export const walkRecordingsRepo = {
  async all(db: SqlExecutor): Promise<WalkRecording[]> {
    const rows = await db.getAllAsync(`SELECT * FROM walk_recordings ORDER BY recorded_at DESC`);
    return rows.map(rowToWalkRecording);
  },
  async insert(db: SqlExecutor, w: WalkRecording): Promise<void> {
    await db.runAsync(
      `INSERT INTO walk_recordings (id, from_label, from_other_text, to_building, minutes, recorded_at)
       VALUES (?,?,?,?,?,?)`,
      [w.id, w.fromLabel, w.fromOtherText ?? null, w.toBuilding, w.minutes, w.recordedAt],
    );
  },
};

// ---------- settings ----------

const SETTINGS_KEY = 'app_settings_v1';

export const settingsRepo = {
  async get(db: SqlExecutor): Promise<AppSettings> {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`,
      [SETTINGS_KEY],
    );
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(row.value);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  async save(db: SqlExecutor, settings: AppSettings): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`,
      [SETTINGS_KEY, JSON.stringify(settings)],
    );
  },
};
