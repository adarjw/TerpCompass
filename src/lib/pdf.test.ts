import { describe, expect, it } from 'vitest';
import { extractPdfText } from './pdf';

/** Build a minimal, uncompressed single-page PDF byte buffer wrapping the
 * given raw content-stream operators (Tj/Td/TD/etc). Not a fully valid PDF
 * (no xref/trailer) — extractPdfText doesn't need one, it just regex-scans
 * for stream/endstream blocks and the dictionary immediately preceding
 * them, which this reproduces exactly. */
function fakePdf(contentStream: string): Uint8Array {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /Contents 2 0 R >>
endobj
2 0 obj
<< /Length ${contentStream.length} >>
stream
${contentStream}
endstream
endobj
`;
  return new Uint8Array([...pdf].map((c) => c.charCodeAt(0)));
}

describe('extractPdfText', () => {
  it('extracts plain text with normal (vertical) line breaks', () => {
    const cs = `BT
100 700 Td
(Hello world) Tj
0 -14 Td
(Second line) Tj
ET`;
    const result = extractPdfText(fakePdf(cs));
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toBe('Hello world\nSecond line');
  });

  it('reconstructs a table row from horizontal-only Td moves as one line with column separators', () => {
    const cs = `BT
100 700 Td
(Week) Tj
150 0 Td
(Sections) Tj
150 0 Td
(Quiz) Tj
ET`;
    const result = extractPdfText(fakePdf(cs));
    expect(result.pages[0].text).toBe('Week | Sections | Quiz');
  });

  it('starts a new line on a vertical (row-break) Td move, not merging rows', () => {
    const cs = `BT
100 700 Td
(Week) Tj
150 0 Td
(Sections) Tj
-150 -20 Td
(Aug 31-Sept 4) Tj
150 0 Td
(Intro) Tj
ET`;
    const result = extractPdfText(fakePdf(cs));
    expect(result.pages[0].text).toBe('Week | Sections\nAug 31-Sept 4 | Intro');
  });

  it('drops trailing empty cells at the end of a row rather than leaving dangling separators', () => {
    const cs = `BT
100 700 Td
(Sept 14-Sept 18) Tj
150 0 Td
(6.1-6.4) Tj
150 0 Td
() Tj
150 0 Td
() Tj
ET`;
    const result = extractPdfText(fakePdf(cs));
    expect(result.pages[0].text).toBe('Sept 14-Sept 18 | 6.1-6.4');
  });

  it('reproduces and fixes the real-world scenario: a multi-row schedule table with a header row and data rows', () => {
    // Mirrors the exact structure that broke before this fix: a header row
    // ("Quiz (on Friday)", "Matlab") whose text used to bleed into every
    // data row once flattened by line, plus a data row where the real
    // event ("Matlab 1 due Monday Sept 21") lives in a different column
    // than the row's own date-range cell.
    const cs = `BT
100 700 Td
(Week) Tj
100 0 Td
(Sections) Tj
150 0 Td
(Quiz \\(on Friday\\)) Tj
150 0 Td
(Matlab) Tj
-500 -20 Td
(Aug 31-Sept 4) Tj
100 0 Td
(Intro \\(0.1-0.3\\)) Tj
150 0 Td
() Tj
150 0 Td
() Tj
-500 -20 Td
(Sept 21-Sept 25) Tj
100 0 Td
(9.1, 9.2) Tj
150 0 Td
(Quiz 2) Tj
150 0 Td
(Matlab 1 due Monday Sept 21 \\(online\\)) Tj
ET`;
    const result = extractPdfText(fakePdf(cs));
    const lines = result.pages[0].text.split('\n');
    expect(lines).toEqual([
      'Week | Sections | Quiz (on Friday) | Matlab',
      'Aug 31-Sept 4 | Intro (0.1-0.3)',
      'Sept 21-Sept 25 | 9.1, 9.2 | Quiz 2 | Matlab 1 due Monday Sept 21 (online)',
    ]);
    // The header's column labels must not appear on either data row.
    expect(lines[1]).not.toContain('Quiz');
    expect(lines[2]).not.toContain('Sections');
  });

  it('falls back to one-newline-per-move for PDFs that do not use horizontal Td moves', () => {
    // A generator that positions every line absolutely (or always includes
    // some vertical component) never triggers the same-row heuristic —
    // behavior here matches what the parser did before this change.
    const cs = `BT
100 700 Td
(Row one) Tj
0 -14 Td
(Row two) Tj
0 -14 Td
(Row three) Tj
ET`;
    const result = extractPdfText(fakePdf(cs));
    expect(result.pages[0].text).toBe('Row one\nRow two\nRow three');
  });

  it('end-to-end: the reconstructed table lets the syllabus detector find both events on their correct rows', async () => {
    const { chunkResourceText } = await import('./syllabus');
    const { detectSyllabusEvents } = await import('./syllabusDates');

    const cs = `BT
100 700 Td
(Week) Tj
100 0 Td
(Sections) Tj
150 0 Td
(Quiz \\(on Friday\\)) Tj
150 0 Td
(Matlab) Tj
-500 -20 Td
(Sept 21-Sept 25) Tj
100 0 Td
(9.1, 9.2) Tj
150 0 Td
(Quiz 2) Tj
150 0 Td
(Matlab 1 due Monday Sept 21 \\(online\\)) Tj
ET`;
    const result = extractPdfText(fakePdf(cs));

    let idc = 0;
    const chunks = chunkResourceText(
      {
        resourceId: 'r1',
        courseId: 'math246',
        sourceFilename: 'math246-syllabus.pdf',
        pages: result.pages,
        defaultYear: 2026,
      },
      () => `c${idc++}`,
    );
    const events = detectSyllabusEvents(chunks);

    // Both the quiz and the Matlab deadline are found, on the same
    // (correct) row/date, with the header text nowhere in sight.
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.kind === 'quiz')).toBe(true);
    expect(events.some((e) => e.kind === 'homework')).toBe(true);
    for (const e of events) {
      expect(chunks.find((c) => c.id === e.chunkId)?.text).not.toContain('Sections');
    }
  });
});
