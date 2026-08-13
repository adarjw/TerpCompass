import { describe, expect, it } from 'vitest';
import { chunkResourceText, detectDate, detectTopic } from './syllabus';

describe('detectDate', () => {
  it('parses ISO dates', () => {
    expect(detectDate('2026-09-09: Pointers', 2026)).toBe('2026-09-09');
  });
  it('parses month-name dates against a default year', () => {
    expect(detectDate('Sep 9: Pointers', 2026)).toBe('2026-09-09');
  });
  it('parses slash dates', () => {
    expect(detectDate('9/9: Pointers', 2026)).toBe('2026-09-09');
  });
  it('returns null when no date is present', () => {
    expect(detectDate('Pointers and memory layout', 2026)).toBeNull();
  });
});

describe('detectTopic', () => {
  it('strips the date and keeps the topic sentence', () => {
    expect(detectTopic('2026-09-09: Pointers and memory layout. Read Chapter 5, pp. 88-104.')).toBe(
      'Pointers and memory layout',
    );
  });
  it('keeps a "Problem Set due" style line separate from the topic', () => {
    expect(detectTopic('2026-09-11: I/O and file descriptors. Problem Set 3 due.')).toBe(
      'I/O and file descriptors',
    );
  });
  it('returns null for a line with nothing but punctuation/numbers after stripping', () => {
    expect(detectTopic('2026-09-09: 123')).toBeNull();
  });
  it('returns the whole remainder when there is only one sentence', () => {
    expect(detectTopic('2026-09-09: Midterm exam in class')).toBe('Midterm exam in class');
  });
});

describe('chunkResourceText topic detection end-to-end', () => {
  it('stores the trimmed topic (not the trailing instruction) on the chunk', () => {
    let n = 0;
    const chunks = chunkResourceText(
      {
        resourceId: 'r1',
        courseId: 'c1',
        sourceFilename: 'syllabus.txt',
        pages: [{ page: 1, text: '2026-09-11: I/O and file descriptors. Problem Set 3 due.' }],
        defaultYear: 2026,
      },
      () => `id-${n++}`,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].detectedTopic).toBe('I/O and file descriptors');
    // The full instruction text is still on the chunk for readings/problems extraction.
    expect(chunks[0].text).toMatch(/Problem Set 3 due/);
  });
});
