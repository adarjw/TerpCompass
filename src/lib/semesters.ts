/**
 * UMD academic-calendar presets so imports can ask "which semester?"
 * instead of making the user type start/end dates. Dates from the official
 * UMD academic calendar. Summer is split into sessions, but the session
 * question is only asked after the user explicitly picks Summer.
 */

export interface SemesterPreset {
  id: string;
  label: string;
  start: string; // YYYY-MM-DD, first day of classes
  end: string; // YYYY-MM-DD, last day of classes
  /** Present only for terms with sub-sessions (Summer). */
  sessions?: { id: string; label: string; start: string; end: string }[];
}

export const SEMESTER_PRESETS: SemesterPreset[] = [
  {
    id: 'fall2026',
    label: 'Fall 2026',
    start: '2026-08-31',
    end: '2026-12-11',
  },
  {
    id: 'winter2027',
    label: 'Winter 2027',
    start: '2027-01-04',
    end: '2027-01-22',
  },
  {
    id: 'spring2027',
    label: 'Spring 2027',
    start: '2027-01-27',
    end: '2027-05-11',
  },
  {
    id: 'summer2027',
    label: 'Summer 2027',
    // Full-term bounds; pick a session for accurate scheduling.
    start: '2027-06-01',
    end: '2027-08-20',
    sessions: [
      { id: 'summer2027-1', label: 'Session I (Jun 1 – Jul 9)', start: '2027-06-01', end: '2027-07-09' },
      { id: 'summer2027-2', label: 'Session II (Jul 12 – Aug 20)', start: '2027-07-12', end: '2027-08-20' },
    ],
  },
];

/**
 * Default selection: the semester containing today, else the next upcoming
 * one, else the last listed.
 */
export function defaultSemesterId(now: Date): string {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  for (const s of SEMESTER_PRESETS) {
    if (today >= s.start && today <= s.end) return s.id;
  }
  for (const s of SEMESTER_PRESETS) {
    if (today < s.start) return s.id;
  }
  return SEMESTER_PRESETS[SEMESTER_PRESETS.length - 1].id;
}
