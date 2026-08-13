/**
 * Optional CLI provider (Claude Code CLI, Codex CLI, or any compatible
 * command). DISABLED by default; the user must opt in and supply the
 * command path in Settings.
 *
 * Reality check, stated in the UI too: a phone app cannot spawn processes.
 * Executing a CLI only works where a process runner exists — i.e. when the
 * app runs under Expo Web/dev on a computer with the CLI installed, or via a
 * future companion bridge. On native devices this provider reports itself
 * unavailable and the app falls back to the local provider gracefully.
 *
 * Privacy/safety contract:
 *  - Only the text chunks the user attached to the course are passed, via
 *    stdin — never whole directories, never credentials, never env secrets.
 *  - The CLI's stdout must be valid JSON matching our schemas; anything else
 *    is rejected ("invalid_output") and the local plan is offered instead.
 *  - The command path is user-configured; the app never downloads or
 *    installs binaries.
 */

import { makeId } from '../ids';
import type { CatchUpPlan, QuizQuestion } from '../types';
import type {
  AIProvider,
  AIResult,
  CatchUpPlanRequest,
  QuizRequest,
  SummarizeRequest,
  SummaryResult,
} from './types';
import { validatePlan, validateQuiz } from './validate';

/** Abstract process runner so the provider is testable and platform-gated. */
export interface CliTransport {
  available(): Promise<boolean>;
  /**
   * Run `command` with args, writing `stdinText` to stdin.
   * Resolves stdout on exit 0; rejects otherwise.
   */
  run(command: string, args: string[], stdinText: string, timeoutMs: number): Promise<string>;
}

/** Native/mobile: no process spawning. Always unavailable. */
export const unavailableTransport: CliTransport = {
  async available() {
    return false;
  },
  async run() {
    throw new Error('Process execution is not available on this platform.');
  },
};

export interface CliProviderConfig {
  enabled: boolean;
  /** Full path or command name, e.g. "claude" or "codex". */
  commandPath: string;
  /** Extra args placed before the prompt flag, e.g. ["-p"] for claude. */
  promptArgs?: string[];
  timeoutMs?: number;
}

const PLAN_INSTRUCTIONS = `You are generating a catch-up plan for a missed university class.
Use ONLY the source material provided in the JSON input. Do not invent topics, readings, page numbers, or sources.
If the material does not clearly show what the missed session covered, set "confidence":"none", "likelyTopic":null and copy this notice verbatim into "notice": "I could not confidently determine the missed material. Please select the topic or upload the relevant resource."
Every citation's sourceFilename must be one of the provided filenames.
Respond with ONLY a JSON object (no markdown fences) with keys:
likelyTopic (string|null), confidence ("high"|"medium"|"low"|"none"), notice (string, optional),
requiredReadings ([{text, citation?:{sourceFilename,page,quote}}]),
relevantFiles ([{sourceFilename,page}]), problems (same shape as requiredReadings),
prerequisites (string[]), estimatedMinutes (number|null), minimumViable (string[]),
deeperVersion (string[]), quiz ([{question, options:string[], answerIndex:number, citation?}]).`;

const QUIZ_INSTRUCTIONS = `Write a short multiple-choice quiz STRICTLY from the provided source chunks.
Do not invent facts. Cite the chunk (sourceFilename, page) for each question.
Respond with ONLY a JSON array of {question, options:string[4], answerIndex:number, citation:{sourceFilename,page}}.`;

function stripJsonFences(s: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  return (fence ? fence[1] : s).trim();
}

export class CliProvider implements AIProvider {
  readonly id: string;
  readonly label: string;

  constructor(
    id: 'claude-cli' | 'other-cli',
    label: string,
    private config: CliProviderConfig,
    private transport: CliTransport,
  ) {
    this.id = id;
    this.label = label;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled || !this.config.commandPath.trim()) return false;
    return this.transport.available();
  }

  private async execute(prompt: string, payload: unknown): Promise<AIResult<unknown>> {
    if (!this.config.enabled) {
      return {
        ok: false,
        error: { code: 'disabled', message: 'CLI provider is disabled in Settings.' },
      };
    }
    if (!(await this.transport.available())) {
      return {
        ok: false,
        error: {
          code: 'provider_unavailable',
          message:
            'Running a CLI is not possible on this device. CLI providers work when the app runs on a computer (Expo web/dev) with the CLI installed.',
        },
      };
    }
    const stdin = JSON.stringify(payload);
    try {
      const out = await this.transport.run(
        this.config.commandPath,
        [...(this.config.promptArgs ?? ['-p']), prompt],
        stdin,
        this.config.timeoutMs ?? 120000,
      );
      try {
        return { ok: true, value: JSON.parse(stripJsonFences(out)) };
      } catch {
        return {
          ok: false,
          error: {
            code: 'invalid_output',
            message: 'The CLI returned output that is not valid JSON. Using the built-in plan instead is recommended.',
          },
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const notFound = /not (?:found|recognized)|ENOENT/i.test(msg);
      return {
        ok: false,
        error: {
          code: notFound ? 'cli_not_found' : 'cli_failed',
          message: notFound
            ? `Command "${this.config.commandPath}" was not found. Check the path in Settings.`
            : `CLI run failed: ${msg.slice(0, 300)}`,
        },
      };
    }
  }

  async generateCatchUpPlan(input: CatchUpPlanRequest): Promise<AIResult<CatchUpPlan>> {
    const knownFiles = new Set(input.chunks.map((c) => c.sourceFilename));
    const result = await this.execute(PLAN_INSTRUCTIONS, {
      course: { code: input.courseCode, name: input.courseName },
      missedDate: input.sessionDate,
      sources: input.chunks.map((c) => ({
        sourceFilename: c.sourceFilename,
        page: c.page,
        detectedDate: c.detectedDate,
        text: c.text,
      })),
    });
    if (!result.ok) return result;
    const plan = validatePlan(
      result.value,
      {
        id: makeId(),
        absenceId: input.absenceId,
        courseId: input.courseId,
        sessionDate: input.sessionDate,
        createdAt: new Date().toISOString(),
        generatedBy: 'ai-cli',
      },
      knownFiles,
    );
    if (!plan) {
      return {
        ok: false,
        error: {
          code: 'invalid_output',
          message:
            'The CLI response did not match the expected plan format (or cited files that were never uploaded).',
        },
      };
    }
    return { ok: true, value: plan };
  }

  async generateQuiz(input: QuizRequest): Promise<AIResult<QuizQuestion[]>> {
    const knownFiles = new Set(input.chunks.map((c) => c.sourceFilename));
    const result = await this.execute(QUIZ_INSTRUCTIONS, {
      topic: input.topic,
      questionCount: input.questionCount,
      sources: input.chunks.map((c) => ({
        sourceFilename: c.sourceFilename,
        page: c.page,
        text: c.text,
      })),
    });
    if (!result.ok) return result;
    const quiz = validateQuiz(result.value, knownFiles);
    if (!quiz || quiz.length === 0) {
      return {
        ok: false,
        error: { code: 'invalid_output', message: 'The CLI quiz response was not valid.' },
      };
    }
    return { ok: true, value: quiz };
  }

  async summarizeResource(input: SummarizeRequest): Promise<AIResult<SummaryResult>> {
    const result = await this.execute(
      'Summarize ONLY from the provided text. Respond with ONLY JSON: {"summary": string, "keyPoints": string[]}.',
      {
        title: input.resourceTitle,
        sources: input.chunks.map((c) => ({ page: c.page, text: c.text })),
      },
    );
    if (!result.ok) return result;
    const v = result.value as Record<string, unknown>;
    if (typeof v?.summary !== 'string' || !Array.isArray(v?.keyPoints)) {
      return {
        ok: false,
        error: { code: 'invalid_output', message: 'The CLI summary response was not valid.' },
      };
    }
    return {
      ok: true,
      value: {
        summary: v.summary.slice(0, 2000),
        keyPoints: (v.keyPoints as unknown[])
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.slice(0, 300)),
        aiGenerated: true,
      },
    };
  }
}
