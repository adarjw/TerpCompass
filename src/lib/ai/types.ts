/**
 * AI provider abstraction. The app is fully functional with the built-in
 * deterministic local provider; CLI/API providers are strictly opt-in.
 *
 * Provider contract:
 *  - Never called with data the user didn't explicitly attach to a course.
 *  - Must return structured JSON that validates against the schemas in
 *    validate.ts, or a typed error — free-text output is rejected.
 *  - Output is always labeled aiGenerated so the UI can badge it.
 *  - Citations must reference real uploaded sources; the app cross-checks
 *    filenames against the resource list and drops fabricated ones.
 */

import type {
  CatchUpPlan,
  QuizQuestion,
  ResourceChunk,
} from '../types';

export interface CatchUpPlanRequest {
  absenceId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  sessionDate: string;
  /** Only chunks from resources the user attached to this course. */
  chunks: ResourceChunk[];
  resourceKinds: Record<string, string>;
}

export interface QuizRequest {
  courseCode: string;
  topic: string;
  chunks: ResourceChunk[];
  questionCount: number;
}

export interface SummarizeRequest {
  resourceTitle: string;
  sourceFilename: string;
  chunks: ResourceChunk[];
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  aiGenerated: boolean;
}

export interface ScheduleImageRequest {
  /** Local file URI of the screenshot; never uploaded by the app itself. */
  imageUri: string;
}

export type AIResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AIError };

export interface AIError {
  code:
    | 'provider_unavailable'
    | 'cli_not_found'
    | 'cli_failed'
    | 'invalid_output'
    | 'not_supported'
    | 'disabled';
  message: string;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  /** Whether this provider can run right now (installed, enabled, platform). */
  isAvailable(): Promise<boolean>;
  generateCatchUpPlan(input: CatchUpPlanRequest): Promise<AIResult<CatchUpPlan>>;
  generateQuiz(input: QuizRequest): Promise<AIResult<QuizQuestion[]>>;
  summarizeResource(input: SummarizeRequest): Promise<AIResult<SummaryResult>>;
  /** Optional: OCR a schedule screenshot into course drafts. */
  extractScheduleFromImage?(
    input: ScheduleImageRequest,
  ): Promise<AIResult<import('../ics').CourseDraft[]>>;
}
