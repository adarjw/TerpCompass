/**
 * Core domain types for Terrapin Class Compass.
 *
 * Times are stored as local wall-clock strings ("HH:MM") and dates as
 * "YYYY-MM-DD". Concrete Date objects are only materialized at the edge
 * (countdowns, notification triggers) so daylight-saving transitions never
 * corrupt stored data.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

/**
 * A course can meet in more than one component (lecture + discussion,
 * lecture + lab, ...), each with its own days/time/room. A course must have
 * at least one meeting pattern.
 */
export type MeetingComponent = 'lecture' | 'discussion' | 'lab' | 'seminar' | 'studio' | 'other';

export interface MeetingPattern {
  id: string;
  courseId: string;
  label: MeetingComponent;
  building: string; // building name or abbreviation
  room: string;
  meetingDays: Weekday[];
  startTime: string; // "HH:MM" local
  endTime: string; // "HH:MM" local
}

export const MEETING_COMPONENT_LABEL: Record<MeetingComponent, string> = {
  lecture: 'Lecture',
  discussion: 'Discussion',
  lab: 'Lab',
  seminar: 'Seminar',
  studio: 'Studio',
  other: 'Class',
};

export interface Course {
  id: string;
  code: string; // e.g. "CMSC131"
  name: string;
  professor: string;
  /** Professor's email, used as the "To" address for absence-notice drafts. */
  professorEmail?: string;
  /** TA email(s), comma-separated; used as "Cc" for absence-notice drafts. */
  taEmails?: string;
  semesterStart: string; // "YYYY-MM-DD"
  semesterEnd: string; // "YYYY-MM-DD"
  attendancePolicy?: string;
  /** Extra minutes of walking buffer the user wants for this course. */
  walkingBufferMin?: number;
  color?: string;
  createdAt: string; // ISO
}

export type SessionStatus =
  | 'scheduled'
  | 'attended'
  | 'absent'
  | 'canceled'
  | 'moved';

export interface ClassSession {
  id: string;
  courseId: string;
  patternId: string;
  patternLabel: MeetingComponent;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  building: string;
  room: string;
  status: SessionStatus;
  /** Set when status is "moved": new location / time note. */
  changeNote?: string;
  /** Building/room override for a moved session. */
  overrideBuilding?: string;
  overrideRoom?: string;
}

export interface Absence {
  id: string;
  sessionId: string;
  courseId: string;
  date: string; // session date
  reason?: string;
  recordedAt: string; // ISO
  catchUpPlanId?: string;
}

/** A single timestamped note jotted during (or right after) a class session. */
export interface ClassNote {
  id: string;
  sessionId: string;
  courseId: string;
  /** Wall-clock time the note was written, "HH:MM" local. */
  timestamp: string;
  text: string;
  createdAt: string; // ISO
}

/**
 * A user-timed walk from a named starting point to a building, used to
 * refine future walking-time estimates for that same route. "Previous
 * class" and "Dorm" are resolved automatically when estimating (see
 * lib/walking.ts); other labels are only ever used when the user explicitly
 * times a walk from that point.
 */
export type WalkStartPoint =
  | 'previous_class'
  | 'dining_south'
  | 'yahentamitsi'
  | '251_north'
  | 'dorm'
  | 'other';

export const WALK_START_POINT_LABEL: Record<WalkStartPoint, string> = {
  previous_class: 'Previous class',
  dining_south: 'Dining Hall (South Campus)',
  yahentamitsi: 'Yahentamitsi Dining Hall',
  '251_north': '251 North',
  dorm: 'Dorm',
  other: 'Other location',
};

export interface WalkRecording {
  id: string;
  fromLabel: WalkStartPoint;
  /** Free-text starting point when fromLabel is 'other'. */
  fromOtherText?: string;
  /** Destination building abbreviation/name (matched against CampusLocation). */
  toBuilding: string;
  minutes: number;
  recordedAt: string; // ISO
}

export type ResourceKind =
  | 'syllabus'
  | 'slides'
  | 'notes'
  | 'text'
  | 'problem_set'
  | 'reading_list'
  | 'announcement'
  | 'link'
  | 'pasted_text';

export interface Resource {
  id: string;
  courseId: string;
  kind: ResourceKind;
  title: string;
  /** Local file URI inside the app sandbox; empty for pasted text/links. */
  fileUri?: string;
  originalFilename?: string;
  url?: string;
  addedAt: string; // ISO
  /** 'ok' | 'no_text' | 'error' — result of local text extraction. */
  extractionStatus: 'ok' | 'no_text' | 'error' | 'pending';
  extractionError?: string;
}

export interface ResourceChunk {
  id: string;
  resourceId: string;
  courseId: string;
  /** Source filename the chunk came from (kept for citations). */
  sourceFilename: string;
  /** 1-based page number when known, otherwise null. */
  page: number | null;
  text: string;
  /** Date this chunk is about, if a date was detected ("YYYY-MM-DD"). */
  detectedDate: string | null;
  /** Topic heading detected for this chunk, if any. */
  detectedTopic: string | null;
  ordinal: number;
}

export interface Citation {
  sourceFilename: string;
  page: number | null;
  quote?: string;
}

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface CatchUpPlan {
  id: string;
  absenceId: string;
  courseId: string;
  sessionDate: string;
  createdAt: string;
  generatedBy: 'local' | 'ai-cli' | 'ai-api' | 'manual';
  /** Clearly labels AI-generated content in the UI. */
  aiGenerated: boolean;
  likelyTopic: string | null;
  confidence: Confidence;
  /** Shown verbatim when confidence is "none". */
  notice?: string;
  requiredReadings: PlanItem[];
  relevantFiles: Citation[];
  problems: PlanItem[];
  prerequisites: string[];
  estimatedMinutes: number | null;
  minimumViable: string[];
  deeperVersion: string[];
  quiz: QuizQuestion[];
  /** Free-form user edits; everything generated is editable. */
  userNotes?: string;
}

export interface PlanItem {
  text: string;
  citation?: Citation;
  done: boolean;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  citation?: Citation;
}

export interface CatchUpTask {
  id: string;
  planId: string;
  courseId: string;
  title: string;
  dueDate: string | null;
  done: boolean;
  createdAt: string;
}

export interface CampusLocation {
  id: string;
  name: string;
  abbreviation: string;
  lat: number | null;
  lon: number | null;
  entranceNotes?: string;
  roomNotes?: string;
  /** Manual walking-time override in minutes from the user's start point. */
  walkOverrideMin?: number;
}

export interface ScheduledNotificationRecord {
  id: string;
  osNotificationId: string;
  sessionId: string | null;
  kind: NotificationKind;
  fireAt: string; // ISO
}

export type NotificationKind =
  | 'morning_summary'
  | 'before_45'
  | 'before_20'
  | 'leave_now'
  | 'before_10'
  | 'catch_up_reminder';

export interface NotificationSettings {
  morningSummary: boolean;
  morningSummaryTime: string; // "HH:MM"
  before45: boolean;
  before20: boolean;
  leaveNow: boolean;
  before10: boolean;
  catchUpReminders: boolean;
}

export interface AppSettings {
  notifications: NotificationSettings;
  /** Starting point for walking estimates. */
  homeLabel: string;
  homeLat: number | null;
  homeLon: number | null;
  walkingSpeedMps: number; // meters/second, default 1.35
  /** AI is off by default; deterministic local provider always available. */
  aiProviderId: 'local' | 'claude-cli' | 'other-cli';
  aiCliEnabled: boolean;
  aiCliPath: string;
  darkMode: 'system' | 'light' | 'dark';
  /** Used to sign absence-notice email drafts. */
  studentName: string;
  /**
   * Web-only, off by default: deliver reminders as push notifications via
   * the app's own relay while the PWA is closed.
   */
  webPushEnabled: boolean;
  /** Whether the first-run welcome walkthrough has already been shown. */
  onboardingSeen: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: {
    morningSummary: true,
    morningSummaryTime: '08:00',
    before45: false,
    before20: true,
    leaveNow: true,
    before10: false,
    catchUpReminders: true,
  },
  homeLabel: 'Home',
  homeLat: null,
  homeLon: null,
  walkingSpeedMps: 1.35,
  aiProviderId: 'local',
  aiCliEnabled: false,
  aiCliPath: '',
  darkMode: 'system',
  studentName: '',
  webPushEnabled: false,
  onboardingSeen: false,
};

/** Importance of physically attending a specific class session. */
export type ImportanceLevel = 'critical' | 'high' | 'normal' | 'low' | 'unknown';

export interface SessionImportance {
  level: ImportanceLevel;
  score: number;
  reasons: string[];
  citations: Citation[];
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
