/**
 * Hand-rolled structural validation for AI provider output. External
 * providers return JSON; anything that doesn't match these schemas is
 * rejected with a typed error instead of being shown to the user.
 * Citations pointing at files the user never uploaded are stripped —
 * a provider cannot cause the app to display fabricated sources.
 */

import type { CatchUpPlan, Citation, PlanItem, QuizQuestion } from '../types';

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function validCitation(v: unknown, knownFiles: Set<string>): Citation | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isString(o.sourceFilename)) return null;
  if (!knownFiles.has(o.sourceFilename)) return null; // fabricated source
  const page =
    typeof o.page === 'number' && Number.isInteger(o.page) && o.page > 0
      ? o.page
      : null;
  return {
    sourceFilename: o.sourceFilename,
    page,
    quote: isString(o.quote) ? o.quote.slice(0, 300) : undefined,
  };
}

function validPlanItems(v: unknown, knownFiles: Set<string>): PlanItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: PlanItem[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    if (!isString(o.text) || o.text.trim() === '') return null;
    const citation = o.citation ? validCitation(o.citation, knownFiles) : null;
    out.push({ text: o.text.slice(0, 500), citation: citation ?? undefined, done: false });
  }
  return out;
}

export function validateQuiz(
  v: unknown,
  knownFiles: Set<string>,
): QuizQuestion[] | null {
  if (!Array.isArray(v)) return null;
  const out: QuizQuestion[] = [];
  for (const q of v) {
    if (typeof q !== 'object' || q === null) return null;
    const o = q as Record<string, unknown>;
    if (!isString(o.question)) return null;
    if (!isStringArray(o.options)) return null;
    const answerIndex =
      typeof o.answerIndex === 'number' && Number.isInteger(o.answerIndex)
        ? o.answerIndex
        : -1;
    if (o.options.length > 0 && (answerIndex < 0 || answerIndex >= o.options.length)) {
      return null;
    }
    const citation = o.citation ? validCitation(o.citation, knownFiles) : null;
    out.push({
      question: o.question.slice(0, 500),
      options: o.options.map((s) => s.slice(0, 300)),
      answerIndex,
      citation: citation ?? undefined,
    });
  }
  return out;
}

const CONFIDENCES = ['high', 'medium', 'low', 'none'] as const;

/**
 * Validate an external provider's plan JSON. `base` supplies the fields the
 * provider is not allowed to control (ids, dates, provenance flags).
 */
export function validatePlan(
  v: unknown,
  base: Pick<
    CatchUpPlan,
    'id' | 'absenceId' | 'courseId' | 'sessionDate' | 'createdAt' | 'generatedBy'
  >,
  knownFiles: Set<string>,
): CatchUpPlan | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;

  const confidence = CONFIDENCES.includes(o.confidence as never)
    ? (o.confidence as CatchUpPlan['confidence'])
    : null;
  if (!confidence) return null;

  const likelyTopic =
    o.likelyTopic === null || o.likelyTopic === undefined
      ? null
      : isString(o.likelyTopic)
        ? o.likelyTopic.slice(0, 300)
        : undefined;
  if (likelyTopic === undefined) return null;
  // Consistency rule: no topic without evidence-backed confidence.
  if (confidence === 'none' && likelyTopic !== null) return null;

  const requiredReadings = validPlanItems(o.requiredReadings ?? [], knownFiles);
  const problems = validPlanItems(o.problems ?? [], knownFiles);
  if (!requiredReadings || !problems) return null;

  const relevantFiles: Citation[] = [];
  if (Array.isArray(o.relevantFiles)) {
    for (const c of o.relevantFiles) {
      const valid = validCitation(c, knownFiles);
      if (valid) relevantFiles.push(valid);
    }
  }

  if (!isStringArray(o.prerequisites ?? [])) return null;
  if (!isStringArray(o.minimumViable ?? [])) return null;
  if (!isStringArray(o.deeperVersion ?? [])) return null;

  const quiz = validateQuiz(o.quiz ?? [], knownFiles);
  if (quiz === null) return null;

  const estimatedMinutes =
    typeof o.estimatedMinutes === 'number' &&
    Number.isFinite(o.estimatedMinutes) &&
    o.estimatedMinutes >= 0
      ? Math.round(o.estimatedMinutes)
      : null;

  return {
    ...base,
    aiGenerated: true,
    likelyTopic,
    confidence,
    notice: isString(o.notice) ? o.notice.slice(0, 500) : undefined,
    requiredReadings,
    relevantFiles,
    problems,
    prerequisites: (o.prerequisites as string[] | undefined ?? []).map((s) => s.slice(0, 200)),
    estimatedMinutes,
    minimumViable: (o.minimumViable as string[] | undefined ?? []).map((s) => s.slice(0, 300)),
    deeperVersion: (o.deeperVersion as string[] | undefined ?? []).map((s) => s.slice(0, 300)),
    quiz,
  };
}
