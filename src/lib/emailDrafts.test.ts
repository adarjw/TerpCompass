import { describe, expect, it } from 'vitest';
import { buildAbsenceEmailDraft, mailtoUrl, type AbsenceReasonCategory } from './emailDrafts';

const course = {
  code: 'CMSC216',
  name: 'Introduction to Computer Systems',
  professor: 'Prof. Rivera',
  professorEmail: 'rivera@umd.edu',
  taEmails: 'ta1@umd.edu, ta2@umd.edu',
};

const session = {
  date: '2026-09-09',
  startTime: '10:00',
  patternLabel: 'lecture' as const,
};

const CATEGORIES: AbsenceReasonCategory[] = [
  'illness',
  'off_campus',
  'medical_appointment',
  'mental_health',
  'conflict',
];

describe('buildAbsenceEmailDraft', () => {
  it('produces a non-empty, distinct draft for every reason category', () => {
    const bodies = CATEGORIES.map(
      (category) => buildAbsenceEmailDraft({ category, course, session, studentName: 'Adar' }).body,
    );
    for (const body of bodies) {
      expect(body.length).toBeGreaterThan(20);
      expect(body).toContain('CMSC216');
    }
    // Each category should read differently, not be a copy-paste of another.
    expect(new Set(bodies).size).toBe(CATEGORIES.length);
  });

  it('uses the stored professor email as the recipient and TA emails as cc', () => {
    const draft = buildAbsenceEmailDraft({ category: 'illness', course, session, studentName: 'Adar' });
    expect(draft.to).toBe('rivera@umd.edu');
    expect(draft.cc).toBe('ta1@umd.edu, ta2@umd.edu');
  });

  it('leaves the recipient blank rather than guessing when no email is on file', () => {
    const draft = buildAbsenceEmailDraft({
      category: 'illness',
      course: { ...course, professorEmail: undefined, taEmails: undefined },
      session,
      studentName: 'Adar',
    });
    expect(draft.to).toBe('');
    expect(draft.cc).toBe('');
  });

  it('signs with the student name, or a placeholder when none is set', () => {
    const withName = buildAbsenceEmailDraft({ category: 'illness', course, session, studentName: 'Adar' });
    expect(withName.body).toContain('Adar');
    const withoutName = buildAbsenceEmailDraft({ category: 'illness', course, session, studentName: '' });
    expect(withoutName.body).toContain('[Your name]');
  });

  it('keeps the mental-health reason generic rather than inventing detail', () => {
    const draft = buildAbsenceEmailDraft({ category: 'mental_health', course, session, studentName: 'Adar' });
    expect(draft.body.toLowerCase()).not.toMatch(/anxiety|depression|therapy/);
  });

  it('marks the conflict reason as a fill-in-the-blank rather than fabricating a reason', () => {
    const draft = buildAbsenceEmailDraft({ category: 'conflict', course, session, studentName: 'Adar' });
    expect(draft.body).toMatch(/\[.*describe.*\]/i);
  });

  it('includes the meeting date and component in the subject', () => {
    const draft = buildAbsenceEmailDraft({ category: 'illness', course, session, studentName: 'Adar' });
    expect(draft.subject).toContain('CMSC216');
    expect(draft.body).toMatch(/Lecture/);
  });
});

describe('mailtoUrl', () => {
  it('builds a mailto link with encoded subject/body and a plain address', () => {
    const draft = buildAbsenceEmailDraft({ category: 'illness', course, session, studentName: 'Adar' });
    const url = mailtoUrl(draft);
    expect(url).toMatch(/^mailto:rivera@umd\.edu\?/);
    expect(url).toContain('cc=ta1%40umd.edu');
    expect(url).toContain('subject=');
    expect(url).toContain('body=');
    expect(url).not.toContain('\n'); // body must be percent-encoded, not literal newlines
  });

  it('omits query params that are empty', () => {
    const draft = { to: '', cc: '', subject: '', body: '' };
    expect(mailtoUrl(draft)).toBe('mailto:');
  });
});
