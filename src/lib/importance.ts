/**
 * "How important is it to be at THIS class?"
 *
 * Deterministic scoring from syllabus/announcement content that mentions the
 * session's date, plus course attendance policy. Every reason cites its
 * source. With no matching content the answer is honestly "unknown" — the
 * app never invents a reason to attend (or skip).
 */

import { chunksForDate, chunksNearDate } from './syllabus';
import type {
  Citation,
  Course,
  ImportanceLevel,
  ResourceChunk,
  SessionImportance,
} from './types';

interface Signal {
  pattern: RegExp;
  points: number;
  label: string;
}

/** Signals scanned against chunks dated on the session day. */
const DAY_SIGNALS: Signal[] = [
  { pattern: /\b(final exam|final)\b/i, points: 100, label: 'Final exam scheduled' },
  { pattern: /\bmidterm\b/i, points: 90, label: 'Midterm scheduled' },
  { pattern: /\bexam\b/i, points: 85, label: 'Exam scheduled' },
  { pattern: /\bquiz\b/i, points: 60, label: 'Quiz scheduled' },
  { pattern: /\btest\b/i, points: 60, label: 'Test scheduled' },
  { pattern: /\bpresentation(s)?\b/i, points: 55, label: 'Presentations scheduled' },
  { pattern: /\b(project|paper|assignment|problem set|pset|hw|homework)\s*(\d+)?\s*(is\s+)?due\b/i, points: 50, label: 'Deliverable due' },
  { pattern: /\bdue\b/i, points: 40, label: 'Something is due' },
  { pattern: /\breview (session|day)?\b/i, points: 45, label: 'Review session' },
  { pattern: /\bguest (speaker|lecture)\b/i, points: 35, label: 'Guest speaker' },
  { pattern: /\blab\b/i, points: 30, label: 'Lab session' },
  { pattern: /\bworkshop\b/i, points: 30, label: 'Workshop' },
  { pattern: /\b(attendance (required|mandatory)|mandatory)\b/i, points: 50, label: 'Attendance explicitly required' },
];

/** Signals in the attendance policy that raise the stakes for every session. */
const POLICY_SIGNALS: Signal[] = [
  { pattern: /\b(attendance|participation)\b.*\b(\d+)\s*%/i, points: 25, label: 'Attendance/participation is graded' },
  { pattern: /\b(drop|lower|reduce)[^.]*\bgrade\b/i, points: 25, label: 'Absences can lower your grade' },
  { pattern: /\bclicker|iclicker|poll(ing)? questions?\b/i, points: 20, label: 'In-class clicker/poll credit' },
  { pattern: /\bno make.?ups?\b/i, points: 20, label: 'No make-ups allowed' },
  { pattern: /\battendance (is )?(taken|recorded|tracked)\b/i, points: 15, label: 'Attendance is taken' },
];

/** Exam within the next few sessions makes lead-up lectures matter more. */
const UPCOMING_EXAM = /\b(exam|midterm|final|quiz|test)\b/i;

function levelFor(score: number, hasAnyInfo: boolean): ImportanceLevel {
  if (!hasAnyInfo) return 'unknown';
  if (score >= 80) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 15) return 'normal';
  return 'low';
}

export function scoreSessionImportance(
  course: Pick<Course, 'attendancePolicy'>,
  sessionDate: string,
  chunks: ResourceChunk[],
): SessionImportance {
  const reasons: string[] = [];
  const citations: Citation[] = [];
  let score = 0;

  const dayChunks = chunksForDate(chunks, sessionDate);
  const seenLabels = new Set<string>();

  for (const chunk of dayChunks) {
    for (const sig of DAY_SIGNALS) {
      if (seenLabels.has(sig.label)) continue;
      if (sig.pattern.test(chunk.text)) {
        seenLabels.add(sig.label);
        score += sig.points;
        reasons.push(sig.label);
        citations.push({
          sourceFilename: chunk.sourceFilename,
          page: chunk.page,
          quote: chunk.text.slice(0, 120),
        });
      }
    }
  }

  // If the topic for the day is known but nothing special, that's still info.
  const topicChunk = dayChunks.find((c) => c.detectedTopic);
  if (topicChunk && reasons.length === 0) {
    score += 10;
    reasons.push(`Lecture topic: ${topicChunk.detectedTopic}`);
    citations.push({
      sourceFilename: topicChunk.sourceFilename,
      page: topicChunk.page,
    });
  }

  // Exam soon after this session? Lead-up classes gain importance.
  const upcoming = chunksNearDate(chunks, sessionDate, 0, 7).filter(
    (c) => c.detectedDate !== sessionDate,
  );
  const examSoon = upcoming.find((c) => UPCOMING_EXAM.test(c.text));
  if (examSoon) {
    score += 20;
    reasons.push(`Exam/quiz within a week (${examSoon.detectedDate})`);
    citations.push({
      sourceFilename: examSoon.sourceFilename,
      page: examSoon.page,
    });
  }

  const policy = course.attendancePolicy?.trim();
  if (policy) {
    for (const sig of POLICY_SIGNALS) {
      if (sig.pattern.test(policy)) {
        score += sig.points;
        reasons.push(sig.label);
      }
    }
  }

  const hasAnyInfo = dayChunks.length > 0 || Boolean(policy);
  return {
    level: levelFor(score, hasAnyInfo),
    score,
    reasons,
    citations,
  };
}

export const IMPORTANCE_LABEL: Record<ImportanceLevel, string> = {
  critical: 'Critical — do not miss',
  high: 'High importance',
  normal: 'Normal importance',
  low: 'Lower stakes',
  unknown: 'Unknown — add a syllabus to find out',
};
