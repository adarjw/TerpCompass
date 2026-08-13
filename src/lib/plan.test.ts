import { describe, expect, it } from 'vitest';
import { buildCatchUpPlan, NO_MATERIAL_NOTICE } from './plan';
import { chunkResourceText } from './syllabus';
import type { ResourceChunk } from './types';

let counter = 0;
const makeId = () => `id-${counter++}`;

function chunksFor(text: string): ResourceChunk[] {
  return chunkResourceText(
    {
      resourceId: 'r1',
      courseId: 'c1',
      sourceFilename: 'syllabus.txt',
      pages: [{ page: 1, text }],
      defaultYear: 2026,
    },
    makeId,
  );
}

describe('buildCatchUpPlan', () => {
  it('never fabricates content when no resource covers the date', () => {
    const plan = buildCatchUpPlan(
      { absenceId: 'a1', courseId: 'c1', sessionDate: '2026-09-09', chunks: [], resourceKinds: {} },
      makeId,
      new Date().toISOString(),
    );
    expect(plan.confidence).toBe('none');
    expect(plan.likelyTopic).toBeNull();
    expect(plan.notice).toBe(NO_MATERIAL_NOTICE);
    expect(plan.requiredReadings).toEqual([]);
  });

  it('extracts topic and readings strictly from matching dated content', () => {
    const text = '2026-09-09: Pointers and memory layout. Read Chapter 5, pp. 88-104.';
    const chunks = chunksFor(text);
    const plan = buildCatchUpPlan(
      { absenceId: 'a1', courseId: 'c1', sessionDate: '2026-09-09', chunks, resourceKinds: {} },
      makeId,
      new Date().toISOString(),
    );
    expect(plan.likelyTopic).toMatch(/Pointers and memory layout/);
    expect(plan.confidence).not.toBe('none');
    expect(plan.requiredReadings.length).toBeGreaterThan(0);
    expect(plan.requiredReadings[0].citation?.sourceFilename).toBe('syllabus.txt');
  });

  it('every citation traces back to the source filename actually provided', () => {
    const text = '2026-09-09: Debugging with GDB. Problem Set 3 due.';
    const chunks = chunksFor(text);
    const plan = buildCatchUpPlan(
      { absenceId: 'a1', courseId: 'c1', sessionDate: '2026-09-09', chunks, resourceKinds: {} },
      makeId,
      new Date().toISOString(),
    );
    const allCitations = [
      ...plan.requiredReadings.map((r) => r.citation),
      ...plan.problems.map((p) => p.citation),
      ...plan.relevantFiles,
    ].filter(Boolean);
    expect(allCitations.length).toBeGreaterThan(0);
    for (const cite of allCitations) {
      expect(cite!.sourceFilename).toBe('syllabus.txt');
    }
  });
});
