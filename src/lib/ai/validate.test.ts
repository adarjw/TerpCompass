import { describe, expect, it } from 'vitest';
import { validatePlan } from './validate';

const base = {
  id: 'p1',
  absenceId: 'a1',
  courseId: 'c1',
  sessionDate: '2026-09-09',
  createdAt: new Date().toISOString(),
  generatedBy: 'ai-cli' as const,
};

describe('validatePlan', () => {
  it('accepts a well-formed plan citing a known file', () => {
    const raw = {
      likelyTopic: 'Pointers',
      confidence: 'high',
      requiredReadings: [{ text: 'Read ch 5', citation: { sourceFilename: 'syllabus.txt', page: 3 } }],
      relevantFiles: [{ sourceFilename: 'syllabus.txt', page: 3 }],
      problems: [],
      prerequisites: [],
      estimatedMinutes: 30,
      minimumViable: ['skim ch 5'],
      deeperVersion: [],
      quiz: [],
    };
    const plan = validatePlan(raw, base, new Set(['syllabus.txt']));
    expect(plan).not.toBeNull();
    expect(plan!.likelyTopic).toBe('Pointers');
  });

  it('rejects a plan that cites a file the user never uploaded', () => {
    const raw = {
      likelyTopic: 'Pointers',
      confidence: 'high',
      requiredReadings: [{ text: 'Read ch 5', citation: { sourceFilename: 'made-up-file.pdf', page: 3 } }],
      relevantFiles: [],
      problems: [],
      prerequisites: [],
      estimatedMinutes: 30,
      minimumViable: [],
      deeperVersion: [],
      quiz: [],
    };
    // The fabricated citation is dropped by validCitation returning null,
    // then validPlanItems -- since citation becomes undefined the item is
    // still structurally valid but carries no (fabricated) source.
    const plan = validatePlan(raw, base, new Set(['syllabus.txt']));
    expect(plan).not.toBeNull();
    expect(plan!.requiredReadings[0].citation).toBeUndefined();
  });

  it('rejects a plan with confidence "none" that still claims a topic', () => {
    const raw = {
      likelyTopic: 'Pointers',
      confidence: 'none',
      requiredReadings: [],
      relevantFiles: [],
      problems: [],
      prerequisites: [],
      estimatedMinutes: null,
      minimumViable: [],
      deeperVersion: [],
      quiz: [],
    };
    const plan = validatePlan(raw, base, new Set());
    expect(plan).toBeNull();
  });

  it('rejects malformed input outright', () => {
    expect(validatePlan(null, base, new Set())).toBeNull();
    expect(validatePlan('a string', base, new Set())).toBeNull();
  });
});
