/**
 * Cancellation/announcement handling for pasted email text and .eml files.
 * Detection only *suggests* schedule changes — the UI always shows a
 * confirmation screen before anything is modified.
 */

import { detectDate } from './syllabus';

export type ScheduleChangeKind =
  | 'canceled'
  | 'moved'
  | 'room_changed'
  | 'remote'
  | 'none';

export interface EmailAnalysis {
  kind: ScheduleChangeKind;
  /** Human-readable summary of what was detected. */
  summary: string;
  /** The sentence(s) that triggered detection, for the confirm screen. */
  evidence: string[];
  /** Date the email refers to, if one could be found. */
  date: string | null;
  /** New room/location text when detected. */
  newLocation: string | null;
  /** Course code mentioned, if any (e.g. CMSC131). */
  courseCode: string | null;
}

interface Rule {
  kind: Exclude<ScheduleChangeKind, 'none'>;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    kind: 'canceled',
    patterns: [
      /\bclass (?:is |will be |has been )?cancell?ed\b/i,
      /\bno class (?:today|tomorrow|on|this)\b/i,
      /\blecture (?:is |will be )?cancell?ed\b/i,
      /\bcancell?ing (?:today'?s?|tomorrow'?s?) (?:class|lecture)\b/i,
      /\bclass (?:today|tomorrow) is cancell?ed\b/i,
    ],
  },
  {
    kind: 'remote',
    patterns: [
      /\bremote class\b/i,
      /\bclass (?:will be |is )?(?:held )?(?:online|remote|virtual|via zoom|on zoom)\b/i,
      /\bzoom link\b/i,
      /\bmoving (?:class )?online\b/i,
    ],
  },
  {
    kind: 'room_changed',
    patterns: [
      /\broom (?:has )?changed?\b/i,
      /\b(?:new|different) room\b/i,
      /\bwill (?:now )?meet in\b/i,
      /\brelocated? to\b/i,
      /\bmeeting relocated\b/i,
    ],
  },
  {
    kind: 'moved',
    patterns: [
      /\bclass (?:is |has been |will be )?moved\b/i,
      /\brescheduled?\b/i,
      /\bpostponed?\b/i,
      /\bmeeting moved\b/i,
    ],
  },
];

const ROOM_RE =
  /\b(?:in|to)\s+((?:[A-Z][A-Za-z.]*\s?){0,3}(?:hall|building|center|centre|bldg\.?|room|rm\.?)?\s*[0-9]{3,4}[A-Za-z]?)\b/;
const COURSE_CODE_RE = /\b([A-Z]{4}\s?\d{3}[A-Z]?|[A-Z]{2,3}\s?\d{3}[A-Z]?)\b/;

/**
 * Strip HTML tags, scripts, style blocks, quoted-printable artifacts and
 * control characters from pasted email content. The result is plain text —
 * nothing from an email is ever executed or rendered as markup.
 */
export function sanitizeEmailText(raw: string): string {
  let s = raw ?? '';
  // Quoted-printable soft line breaks and hex escapes (common in .eml).
  s = s.replace(/=\r?\n/g, '');
  s = s.replace(/=([0-9A-F]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return code >= 32 || code === 10 || code === 13 ? String.fromCharCode(code) : ' ';
  });
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Collapse runs of whitespace (but keep newlines) and drop control chars.
  s = s.replace(/[^\S\n]+/g, ' ').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return s.trim();
}

/**
 * Extract the text body from a raw .eml file (headers + body).
 * Handles simple single-part and multipart messages; falls back to the
 * whole body when boundaries can't be resolved.
 */
export function extractEmlBody(eml: string): { subject: string; body: string } {
  const headerEnd = eml.search(/\r?\n\r?\n/);
  const headers = headerEnd >= 0 ? eml.slice(0, headerEnd) : '';
  let body = headerEnd >= 0 ? eml.slice(headerEnd) : eml;

  const subjectMatch = /^subject:\s*(.*)$/im.exec(headers);
  const subject = subjectMatch ? subjectMatch[1].trim() : '';

  const boundaryMatch = /boundary="?([^";\r\n]+)"?/i.exec(headers);
  if (boundaryMatch) {
    const parts = body.split(`--${boundaryMatch[1]}`);
    // Prefer a text/plain part, else first non-empty part.
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    const chosen = plain ?? parts.find((p) => p.trim().length > 0) ?? body;
    const partHeaderEnd = chosen.search(/\r?\n\r?\n/);
    body = partHeaderEnd >= 0 ? chosen.slice(partHeaderEnd) : chosen;
  }
  return { subject, body: sanitizeEmailText(body) };
}

/** Sentences (rough split) that matched any rule, for the confirm screen. */
function findEvidence(text: string, patterns: RegExp[]): string[] {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (patterns.some((p) => p.test(sentence))) {
      out.push(sentence.trim().slice(0, 200));
    }
    if (out.length >= 3) break;
  }
  return out;
}

export function analyzeEmail(rawText: string, defaultYear: number): EmailAnalysis {
  const text = sanitizeEmailText(rawText);
  if (!text) {
    return {
      kind: 'none',
      summary: 'No readable text found.',
      evidence: [],
      date: null,
      newLocation: null,
      courseCode: null,
    };
  }

  let matched: Rule | null = null;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      matched = rule;
      break; // Rules are ordered by specificity: canceled > remote > room > moved.
    }
  }

  const lower = text.toLowerCase();
  let date = detectDate(text, defaultYear);
  if (!date && /\btoday\b/.test(lower)) date = 'TODAY';
  if (!date && /\btomorrow\b/.test(lower)) date = 'TOMORROW';

  const courseMatch = COURSE_CODE_RE.exec(text);
  const roomMatch =
    matched && (matched.kind === 'room_changed' || matched.kind === 'moved')
      ? ROOM_RE.exec(text)
      : null;

  if (!matched) {
    return {
      kind: 'none',
      summary: 'No cancellation or schedule change detected in this text.',
      evidence: [],
      date,
      newLocation: null,
      courseCode: courseMatch ? courseMatch[1].replace(/\s+/g, '') : null,
    };
  }

  const summaries: Record<Exclude<ScheduleChangeKind, 'none'>, string> = {
    canceled: 'Class appears to be CANCELED',
    remote: 'Class appears to be REMOTE/ONLINE',
    room_changed: 'Room appears to have CHANGED',
    moved: 'Class appears to be MOVED/RESCHEDULED',
  };

  return {
    kind: matched.kind,
    summary: summaries[matched.kind],
    evidence: findEvidence(text, matched.patterns),
    date,
    newLocation: roomMatch ? roomMatch[1].trim() : null,
    courseCode: courseMatch ? courseMatch[1].replace(/\s+/g, '') : null,
  };
}
