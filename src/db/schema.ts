/** SQLite DDL. Version-gated so future migrations are additive. */

export const SCHEMA_VERSION = 5;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  professor TEXT NOT NULL DEFAULT '',
  professor_email TEXT,
  ta_emails TEXT,
  semester_start TEXT NOT NULL,        -- "YYYY-MM-DD"
  semester_end TEXT NOT NULL,
  attendance_policy TEXT,
  walking_buffer_min INTEGER,
  color TEXT,
  created_at TEXT NOT NULL
);

-- A course meets in one or more components (lecture, discussion, lab, ...),
-- each with its own days/time/room.
CREATE TABLE IF NOT EXISTS meeting_patterns (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'lecture',
  building TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  meeting_days TEXT NOT NULL,          -- JSON array of 0-6
  start_time TEXT NOT NULL,            -- "HH:MM"
  end_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patterns_course ON meeting_patterns(course_id);

CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL REFERENCES meeting_patterns(id) ON DELETE CASCADE,
  pattern_label TEXT NOT NULL DEFAULT 'lecture',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  building TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  change_note TEXT,
  override_building TEXT,
  override_room TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON class_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON class_sessions(date);

CREATE TABLE IF NOT EXISTS absences (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT,
  recorded_at TEXT NOT NULL,
  catch_up_plan_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_absences_course ON absences(course_id);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  file_uri TEXT,
  original_filename TEXT,
  url TEXT,
  added_at TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_resources_course ON resources(course_id);

CREATE TABLE IF NOT EXISTS extracted_resource_chunks (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  page INTEGER,
  text TEXT NOT NULL,
  detected_date TEXT,
  detected_topic TEXT,
  ordinal INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON extracted_resource_chunks(course_id);
CREATE INDEX IF NOT EXISTS idx_chunks_date ON extracted_resource_chunks(detected_date);

CREATE TABLE IF NOT EXISTS catch_up_plans (
  id TEXT PRIMARY KEY,
  absence_id TEXT NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  likely_topic TEXT,
  confidence TEXT NOT NULL,
  notice TEXT,
  payload TEXT NOT NULL,               -- JSON: readings/problems/quiz/etc.
  user_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_plans_course ON catch_up_plans(course_id);

CREATE TABLE IF NOT EXISTS catch_up_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES catch_up_plans(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  os_notification_id TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  fire_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campus_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL DEFAULT '',
  lat REAL,
  lon REAL,
  entrance_notes TEXT,
  room_notes TEXT,
  walk_override_min INTEGER
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  kind TEXT NOT NULL DEFAULT 'other'
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Timestamped notes jotted during (or right after) a class session.
CREATE TABLE IF NOT EXISTS class_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_session ON class_notes(session_id);

-- A user-timed walk from a named starting point to a building, used to
-- refine future walking-time estimates for that route.
CREATE TABLE IF NOT EXISTS walk_recordings (
  id TEXT PRIMARY KEY,
  from_label TEXT NOT NULL,
  from_other_text TEXT,
  to_building TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_walk_recordings_route ON walk_recordings(from_label, to_building);

-- Cached PlanetTerp enrichment per course code, so fetched data (title,
-- professors, GPA, attendance hints) keeps working offline.
CREATE TABLE IF NOT EXISTS planetterp_cache (
  course_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`;

/** Tables dropped and recreated by a destructive schema migration, in FK-safe order. */
export const ALL_TABLES = [
  'notifications',
  'catch_up_tasks',
  'catch_up_plans',
  'extracted_resource_chunks',
  'resources',
  'absences',
  'class_sessions',
  'meeting_patterns',
  'calendar_events',
  'courses',
  'campus_locations',
  'planetterp_cache',
];
