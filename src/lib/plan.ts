/**
 * Deterministic catch-up plan builder — the always-available fallback
 * "AI provider". It only uses facts found in uploaded resources for the
 * missed date; when nothing matches, it says so plainly instead of guessing.
 */

import { chunksForDate, chunksNearDate } from './syllabus';
import type {
  CatchUpPlan,
  Citation,
  Confidence,
  PlanItem,
  QuizQuestion,
  ResourceChunk,
} from './types';

export const NO_MATERIAL_NOTICE =
  'I could not confidently determine the missed material. Please select the topic or upload the relevant resource.';

export interface PlanBuildInput {
  absenceId: string;
  courseId: string;
  sessionDate: string;
  chunks: ResourceChunk[];
  /** Kind of each chunk's parent resource, keyed by resourceId. */
  resourceKinds: Record<string, string>;
}

const READING_RE = /\b(read(?:ing)?s?|chapter|ch\.|section|§|pages?|pp\.)\b/i;
const PROBLEM_RE = /\b(problem set|pset|problems?|exercises?|hw|homework|assignment)\b/i;

function cite(c: ResourceChunk): Citation {
  return { sourceFilename: c.sourceFilename, page: c.page, quote: c.text.slice(0, 160) };
}

function uniqueItems(items: PlanItem[]): PlanItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildCatchUpPlan(
  input: PlanBuildInput,
  makeId: () => string,
  nowISO: string,
): CatchUpPlan {
  const dayChunks = chunksForDate(input.chunks, input.sessionDate);
  const nearby = chunksNearDate(input.chunks, input.sessionDate, 10, 0).filter(
    (c) => c.detectedDate !== input.sessionDate,
  );

  const topicChunk = dayChunks.find((c) => c.detectedTopic);
  const likelyTopic = topicChunk?.detectedTopic ?? null;

  let confidence: Confidence;
  if (topicChunk && dayChunks.length > 1) confidence = 'high';
  else if (topicChunk) confidence = 'medium';
  else if (dayChunks.length > 0) confidence = 'low';
  else confidence = 'none';

  const requiredReadings: PlanItem[] = [];
  const problems: PlanItem[] = [];
  const relevantFiles: Citation[] = [];
  const seenFiles = new Set<string>();

  for (const chunk of dayChunks) {
    const fileKey = `${chunk.sourceFilename}#${chunk.page ?? ''}`;
    if (!seenFiles.has(fileKey)) {
      seenFiles.add(fileKey);
      relevantFiles.push({ sourceFilename: chunk.sourceFilename, page: chunk.page });
    }
    if (READING_RE.test(chunk.text)) {
      requiredReadings.push({ text: chunk.text.slice(0, 300), citation: cite(chunk), done: false });
    }
    if (PROBLEM_RE.test(chunk.text)) {
      problems.push({ text: chunk.text.slice(0, 300), citation: cite(chunk), done: false });
    }
    // Slides/notes uploaded for that date are directly relevant even without keywords.
    const kind = input.resourceKinds[chunk.resourceId];
    if ((kind === 'slides' || kind === 'notes') && !READING_RE.test(chunk.text)) {
      requiredReadings.push({
        text: `Go through: ${chunk.sourceFilename}${chunk.page ? ` (page ${chunk.page})` : ''}`,
        citation: cite(chunk),
        done: false,
      });
    }
  }

  // Prerequisites: topics from the previous ~10 days of the schedule.
  const prerequisites = [
    ...new Set(
      nearby
        .map((c) => c.detectedTopic)
        .filter((t): t is string => Boolean(t))
        .slice(-3),
    ),
  ];

  const readings = uniqueItems(requiredReadings).slice(0, 6);
  const probs = uniqueItems(problems).slice(0, 4);

  // Time estimate: only when we actually have material. ~25 min per reading,
  // ~20 per problem item, +15 base review.
  const estimatedMinutes =
    confidence === 'none' ? null : 15 + readings.length * 25 + probs.length * 20;

  const minimumViable: string[] = [];
  const deeperVersion: string[] = [];
  if (confidence !== 'none') {
    if (likelyTopic) minimumViable.push(`Skim the material for "${likelyTopic}"`);
    if (readings[0]) minimumViable.push(`Read: ${readings[0].text.slice(0, 120)}`);
    minimumViable.push('Ask a classmate for their notes from this session');
    if (likelyTopic) deeperVersion.push(`Work through all material on "${likelyTopic}" in detail`);
    for (const r of readings) deeperVersion.push(`Read fully: ${r.text.slice(0, 120)}`);
    for (const p of probs) deeperVersion.push(`Complete: ${p.text.slice(0, 120)}`);
    deeperVersion.push('Write a half-page summary in your own words');
    if (prerequisites.length > 0) {
      deeperVersion.push(`Review prerequisites first: ${prerequisites.join('; ')}`);
    }
  }

  // The deterministic provider builds recall prompts strictly from source
  // text — it cannot author real multiple-choice questions without inventing
  // content, so it emits open "check yourself" prompts with citations.
  const quiz: QuizQuestion[] = [];
  if (likelyTopic && topicChunk) {
    quiz.push({
      question: `In your own words, what is "${likelyTopic}"? Check against the source below.`,
      options: [],
      answerIndex: -1,
      citation: cite(topicChunk),
    });
  }
  for (const r of readings.slice(0, 3)) {
    if (r.citation) {
      quiz.push({
        question: `Summarize the key point of: ${r.text.slice(0, 100)}`,
        options: [],
        answerIndex: -1,
        citation: r.citation,
      });
    }
  }

  return {
    id: makeId(),
    absenceId: input.absenceId,
    courseId: input.courseId,
    sessionDate: input.sessionDate,
    createdAt: nowISO,
    generatedBy: 'local',
    aiGenerated: false,
    likelyTopic,
    confidence,
    notice: confidence === 'none' ? NO_MATERIAL_NOTICE : undefined,
    requiredReadings: readings,
    relevantFiles,
    problems: probs,
    prerequisites,
    estimatedMinutes,
    minimumViable,
    deeperVersion,
    quiz,
  };
}
