import { describe, expect, it } from 'vitest';
import { detectScheduleHint } from './noteSchedule';

describe('detectScheduleHint', () => {
  // 2026-08-11 is a Tuesday.
  const tuesday = '2026-08-11';

  it('resolves a weekday name to the nearest matching date', () => {
    const hint = detectScheduleHint('exam Thursday, covers chapters 4-6', tuesday);
    expect(hint?.kind).toBe('exam');
    expect(hint?.dateISO).toBe('2026-08-13');
  });

  it('resolves "next <day>" a week past the nearest occurrence', () => {
    const hint = detectScheduleHint('paper due next Monday', tuesday);
    expect(hint?.kind).toBe('deadline');
    expect(hint?.dateISO).toBe('2026-08-24');
  });

  it('resolves "tomorrow" relative to the reference date', () => {
    const hint = detectScheduleHint('quiz tomorrow on recursion', tuesday);
    expect(hint?.dateISO).toBe('2026-08-12');
  });

  it('resolves "today" to the reference date itself', () => {
    const hint = detectScheduleHint('midterm today, open notes', tuesday);
    expect(hint?.dateISO).toBe(tuesday);
  });

  it('falls back to an absolute date when no weekday is present', () => {
    const hint = detectScheduleHint('final exam on 12/15', tuesday);
    expect(hint?.dateISO).toBe('2026-12-15');
  });

  it('returns null with a date but no exam/deadline keyword', () => {
    expect(detectScheduleHint('walked to class Thursday, nice weather', tuesday)).toBeNull();
  });

  it('returns null with a keyword but no resolvable date', () => {
    expect(detectScheduleHint('professor mentioned an exam is coming up', tuesday)).toBeNull();
  });
});
