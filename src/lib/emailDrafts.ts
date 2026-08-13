/**
 * Absence-notice email drafts. The app never sends anything itself — it
 * only builds a subject/body and hands off to the device's own mail app via
 * a `mailto:` link, so the user reviews and presses send themselves.
 *
 * Templates intentionally stay generic where the real reason is private
 * (mental health) or unknowable to the app (the specifics of a conflict/
 * trip) — bracketed placeholders mark spots the user should fill in rather
 * than the app guessing at details it can't know.
 */

import { MEETING_COMPONENT_LABEL, type ClassSession, type Course } from './types';
import { formatDateHuman, formatTime12 } from './time';

export type AbsenceReasonCategory =
  | 'illness'
  | 'off_campus'
  | 'medical_appointment'
  | 'mental_health'
  | 'conflict';

export const ABSENCE_REASON_LABEL: Record<AbsenceReasonCategory, string> = {
  illness: 'Sickness',
  off_campus: 'Not on campus',
  medical_appointment: 'Doctor / dentist appointment',
  mental_health: 'Mental health',
  conflict: 'Conflict / extracurricular trip',
};

export interface EmailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

interface DraftInput {
  category: AbsenceReasonCategory;
  course: Pick<Course, 'code' | 'name' | 'professor' | 'professorEmail' | 'taEmails'>;
  session: Pick<ClassSession, 'date' | 'startTime' | 'patternLabel'>;
  studentName: string;
}

function reasonLine(category: AbsenceReasonCategory): string {
  switch (category) {
    case 'illness':
      return "I'm feeling unwell and won't be able to attend";
    case 'off_campus':
      return "I won't be on campus and won't be able to attend";
    case 'medical_appointment':
      return "I have a doctor's/dentist's appointment that conflicts with";
    case 'mental_health':
      return "I'm not able to attend";
    case 'conflict':
      return "I have a scheduling conflict ([briefly describe: e.g. a competition, interview, or family commitment]) that overlaps with";
  }
}

function closingLine(category: AbsenceReasonCategory): string {
  if (category === 'mental_health') {
    return "I'd appreciate it if you could let me know about anything important I should be aware of. I'll follow up on coursework as needed.";
  }
  return "I'll catch up on anything I miss, and I'm happy to submit any work in advance or make other arrangements if that's helpful.";
}

/** Build an editable draft. Nothing here is sent — the caller opens it in a mail app for the user to review. */
export function buildAbsenceEmailDraft(input: DraftInput): EmailDraft {
  const { category, course, session, studentName } = input;
  const dateLabel = formatDateHuman(session.date);
  const componentLabel = MEETING_COMPONENT_LABEL[session.patternLabel];
  const whenLabel = `${componentLabel} on ${dateLabel} at ${formatTime12(session.startTime)}`;
  const greeting = course.professor.trim() ? `Dear ${course.professor.trim()},` : 'Hello,';

  const body = [
    greeting,
    '',
    `${reasonLine(category)} ${course.code}${course.name ? ` (${course.name})` : ''}, ${whenLabel}.`,
    '',
    closingLine(category),
    '',
    'Thank you for understanding,',
    studentName.trim() || '[Your name]',
  ].join('\n');

  const taList = (course.taEmails ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  return {
    to: course.professorEmail?.trim() ?? '',
    cc: taList.join(', '),
    subject: `${course.code} — absence notice for ${dateLabel}`,
    body,
  };
}

function encodeMailtoField(value: string): string {
  // encodeURIComponent handles spaces/newlines/@ etc.; mailto additionally
  // wants commas in to/cc left un-encoded per RFC 6068, but encoding them is
  // still accepted by every major mail client, so we keep this simple.
  return encodeURIComponent(value);
}

/** Build a `mailto:` URL for the draft. Opens the user's own mail app to review/send. */
export function mailtoUrl(draft: EmailDraft): string {
  const params: string[] = [];
  if (draft.cc) params.push(`cc=${encodeMailtoField(draft.cc)}`);
  if (draft.subject) params.push(`subject=${encodeMailtoField(draft.subject)}`);
  if (draft.body) params.push(`body=${encodeMailtoField(draft.body)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  // The "to" address itself is left un-encoded (mailto:user@example.com,
  // not user%40example.com) — only the query fields need encoding.
  return `mailto:${draft.to}${query}`;
}
