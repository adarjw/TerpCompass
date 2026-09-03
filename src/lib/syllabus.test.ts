import { describe, expect, it } from 'vitest';
import { chunkResourceText, detectContacts, detectDate, detectTopic } from './syllabus';

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

describe('detectContacts', () => {
  it('classifies a same-line "Professor: ... (email)" contact', () => {
    const result = detectContacts('Professor: Jane Doe (jdoe@umd.edu)');
    expect(result.professorEmail).toBe('jdoe@umd.edu');
    expect(result.taEmails).toEqual([]);
  });

  it('classifies multiple TA emails, each on their own labeled line', () => {
    const result = detectContacts('TA: John Smith - jsmith@umd.edu\nTA: Amy Lee - alee@umd.edu');
    expect(result.taEmails).toEqual(['jsmith@umd.edu', 'alee@umd.edu']);
  });

  it('carries a role label over to the email on the next non-blank line', () => {
    const result = detectContacts('Instructor\nJane Doe\njdoe@umd.edu');
    expect(result.professorEmail).toBe('jdoe@umd.edu');
  });

  it('resets the pending role after a blank line', () => {
    const result = detectContacts('Professor\nJane Doe\n\nOffice: IRB 1234\ncontact@registrar.umd.edu');
    expect(result.professorEmail).toBeNull();
  });

  it('does not classify an email with no nearby role label', () => {
    const result = detectContacts('Questions? Email help@umd.edu.');
    expect(result.professorEmail).toBeNull();
    expect(result.taEmails).toEqual([]);
  });

  it('lowercases emails and never classifies the same address as both roles', () => {
    const result = detectContacts('Professor: jdoe@umd.edu\nTA: JDOE@umd.edu');
    expect(result.professorEmail).toBe('jdoe@umd.edu');
    expect(result.taEmails).toEqual([]);
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

describe('chunkResourceText merges a keyword line with its date on the next line', () => {
  function chunkText(text: string) {
    let n = 0;
    return chunkResourceText(
      { resourceId: 'r1', courseId: 'c1', sourceFilename: 'physics.pdf', pages: [{ page: 1, text }], defaultYear: 2026 },
      () => `id-${n++}`,
    );
  }

  it('joins a bare "midterm" line to a dateless line into one dated chunk', () => {
    // Reported real-world case: a prose syllabus names the exam on one
    // line and puts its date entirely on the next, rather than sharing a
    // line with it.
    const chunks = chunkText('Midterm 2 will be held on\nNovember 10th.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].detectedDate).toBe('2026-11-10');
    expect(chunks[0].text).toBe('Midterm 2 will be held on November 10th.');
  });

  it('does the same for "exam" and "quiz"', () => {
    expect(chunkText('The final exam is scheduled for\nDecember 15.')[0].detectedDate).toBe('2026-12-15');
    expect(chunkText('There will be a quiz on\nSeptember 22.')[0].detectedDate).toBe('2026-09-22');
  });

  it('keeps two consecutive keyword+wrapped-date pairs separate, not conflated', () => {
    const chunks = chunkText(
      'Midterm 1 will be held on\nOctober 6th.\nMidterm 2 will be held on\nNovember 10th.',
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].detectedDate).toBe('2026-10-06');
    expect(chunks[1].detectedDate).toBe('2026-11-10');
  });

  it('does not merge when the next line has its own keyword (a different exam, not a continuation)', () => {
    const chunks = chunkText('Midterm 1 will be announced later.\nMidterm 2: October 6th.');
    // The first line has no date and gets swept into a plain paragraph
    // chunk instead of wrongly grabbing the second midterm's date.
    const dated = chunks.filter((c) => c.detectedDate);
    expect(dated).toHaveLength(1);
    expect(dated[0].detectedDate).toBe('2026-10-06');
    expect(dated[0].text).not.toContain('announced later');
  });

  it('leaves a keyword line with its own date untouched (no unnecessary merge)', () => {
    const chunks = chunkText('Midterm 1: October 6th\nMidterm 2: November 10th');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].detectedDate).toBe('2026-10-06');
    expect(chunks[1].detectedDate).toBe('2026-11-10');
  });

  it('does not merge a keyword-less line even if the next line has a date', () => {
    const chunks = chunkText('Office hours are Tuesdays.\nOctober 6th is a holiday.');
    // No exam/quiz/midterm keyword involved at all — ordinary text stays
    // exactly as chunked before this fix.
    expect(chunks.some((c) => c.text.includes('Office hours are Tuesdays. October'))).toBe(false);
  });
});
