/**
 * Deterministic local provider — always available, never sends data
 * anywhere, and is the default. It reuses the rule-based planner and only
 * ever emits content that literally exists in uploaded resources.
 */

import { makeId } from '../ids';
import { buildCatchUpPlan } from '../plan';
import type { QuizQuestion } from '../types';
import type {
  AIProvider,
  AIResult,
  CatchUpPlanRequest,
  QuizRequest,
  SummarizeRequest,
  SummaryResult,
} from './types';

export class LocalProvider implements AIProvider {
  readonly id = 'local';
  readonly label = 'Built-in (on-device, no AI)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateCatchUpPlan(input: CatchUpPlanRequest) {
    const plan = buildCatchUpPlan(
      {
        absenceId: input.absenceId,
        courseId: input.courseId,
        sessionDate: input.sessionDate,
        chunks: input.chunks,
        resourceKinds: input.resourceKinds,
      },
      makeId,
      new Date().toISOString(),
    );
    return { ok: true as const, value: plan };
  }

  async generateQuiz(input: QuizRequest): Promise<AIResult<QuizQuestion[]>> {
    // Recall prompts built strictly from source text; the local provider
    // does not author multiple-choice distractors (that would be invention).
    const questions: QuizQuestion[] = [];
    for (const chunk of input.chunks.slice(0, input.questionCount)) {
      questions.push({
        question: `Explain in your own words, then check the source: "${chunk.text.slice(0, 140)}..."`,
        options: [],
        answerIndex: -1,
        citation: {
          sourceFilename: chunk.sourceFilename,
          page: chunk.page,
        },
      });
    }
    if (questions.length === 0) {
      return {
        ok: false,
        error: {
          code: 'invalid_output',
          message:
            'No source material available to build a quiz from. Upload notes or slides for this topic first.',
        },
      };
    }
    return { ok: true, value: questions };
  }

  async summarizeResource(input: SummarizeRequest): Promise<AIResult<SummaryResult>> {
    if (input.chunks.length === 0) {
      return {
        ok: false,
        error: {
          code: 'invalid_output',
          message: 'No extracted text to summarize for this resource.',
        },
      };
    }
    // Extractive "summary": first sentences of the leading chunks, cited.
    const keyPoints = input.chunks
      .slice(0, 5)
      .map((c) => c.text.split(/(?<=[.!?])\s/)[0]?.slice(0, 200))
      .filter((s): s is string => Boolean(s && s.length > 10));
    return {
      ok: true,
      value: {
        summary: `Extract from ${input.sourceFilename} (first passages, not an AI summary).`,
        keyPoints,
        aiGenerated: false,
      },
    };
  }
}
