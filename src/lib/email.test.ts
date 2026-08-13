import { describe, expect, it } from 'vitest';
import { analyzeEmail, extractEmlBody, sanitizeEmailText } from './email';

describe('sanitizeEmailText', () => {
  it('strips HTML tags and scripts', () => {
    const out = sanitizeEmailText('<p>Hello</p><script>alert(1)</script><b>world</b>');
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).not.toMatch(/alert/);
    expect(out).toMatch(/Hello/);
    expect(out).toMatch(/world/);
  });

  it('decodes basic HTML entities', () => {
    expect(sanitizeEmailText('A &amp; B &lt;3&gt;')).toBe('A & B <3>');
  });
});

describe('analyzeEmail', () => {
  it('detects a cancellation', () => {
    const result = analyzeEmail('Hi all, todays CMSC216 class is cancelled due to weather.', 2026);
    expect(result.kind).toBe('canceled');
    expect(result.courseCode).toBe('CMSC216');
  });

  it('detects a room change with the new room', () => {
    const result = analyzeEmail('Room has changed: MATH241 will now meet in Kirwan 0305.', 2026);
    expect(result.kind).toBe('room_changed');
  });

  it('detects a remote/online class', () => {
    const result = analyzeEmail('Reminder: class will be held online via Zoom today.', 2026);
    expect(result.kind).toBe('remote');
  });

  it('returns none for unrelated text without guessing', () => {
    const result = analyzeEmail('Reminder: office hours are Tuesday at 2pm.', 2026);
    expect(result.kind).toBe('none');
  });
});

describe('extractEmlBody', () => {
  it('extracts subject and plain body from a simple eml', () => {
    const eml = 'Subject: Class canceled\r\nFrom: prof@umd.edu\r\n\r\nClass is canceled today.';
    const { subject, body } = extractEmlBody(eml);
    expect(subject).toBe('Class canceled');
    expect(body).toMatch(/canceled today/);
  });
});
