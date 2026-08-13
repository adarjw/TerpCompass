/**
 * Attendance-hint mining from PlanetTerp reviews (pure logic, no network).
 *
 * PlanetTerp has no attendance-policy field — the only signal is what
 * students wrote in reviews. So everything here is advisory: hints are
 * verbatim review sentences (clearly attributable), and the policy
 * "summary" is a keyword digest explicitly prefixed with its source. It is
 * never applied to a course without the user tapping to accept it.
 */

export interface PTReview {
  professor?: string | null;
  course: string | null;
  review: string;
  rating: number | null;
}

export interface AttendanceHint {
  /** Verbatim sentence from a review (trimmed). */
  text: string;
  course: string | null;
  rating: number | null;
}

const HINT_RE =
  /attendance|i?-?clicker|participation (?:points|grade|credit)|pop quiz|quiz(?:zes)? (?:at the (?:start|beginning)|in class|every|each)|mandatory|lectures? (?:are|were) recorded|(?:don'?t|didn'?t|never) (?:need to |have to )?(?:go\b|show up|attend)|skip(?:ping|ped)? (?:class|lecture)/i;

/** Split review text into rough sentences. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Pull attendance-related sentences out of reviews, preferring reviews tagged
 * with the given course code. Deduped, capped, trimmed.
 */
export function extractAttendanceHints(
  reviews: PTReview[],
  courseCode: string,
  cap = 6,
): AttendanceHint[] {
  const code = courseCode.toUpperCase();
  // Course-specific reviews first, then untagged, then other courses last.
  const ordered = [...reviews].sort((a, b) => {
    const rank = (r: PTReview) => (r.course?.toUpperCase() === code ? 0 : r.course ? 2 : 1);
    return rank(a) - rank(b);
  });

  const seen = new Set<string>();
  const hints: AttendanceHint[] = [];
  for (const review of ordered) {
    for (const sentence of sentences(review.review ?? '')) {
      if (!HINT_RE.test(sentence)) continue;
      const key = sentence.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push({
        text: sentence.length > 220 ? sentence.slice(0, 217) + '…' : sentence,
        course: review.course,
        rating: review.rating,
      });
      if (hints.length >= cap) return hints;
    }
  }
  return hints;
}

interface Theme {
  pattern: RegExp;
  phrase: string;
}

/**
 * Themes composed into the suggested policy line. Phrases deliberately reuse
 * the keywords the importance scorer's policy signals look for (clicker,
 * attendance taken, quizzes, no make-ups) so accepting the suggestion feeds
 * the attendance-importance meter naturally.
 */
const THEMES: Theme[] = [
  { pattern: /i?-?clicker/i, phrase: 'clickers used in class' },
  { pattern: /attendance (?:is |was )?(?:taken|tracked|recorded|checked)/i, phrase: 'attendance taken' },
  { pattern: /attendance (?:is |was )?(?:mandatory|required)|mandatory attendance/i, phrase: 'attendance mandatory' },
  { pattern: /participation (?:points|grade|credit)/i, phrase: 'participation graded' },
  { pattern: /pop quiz|quiz(?:zes)? (?:at the (?:start|beginning)|in class|every|each)/i, phrase: 'in-class quizzes' },
  { pattern: /no make.?ups?/i, phrase: 'no make-ups' },
  {
    pattern: /lectures? (?:are|were) recorded|(?:don'?t|didn'?t|never) (?:need to |have to )?(?:go\b|show up|attend)|attendance (?:is |was )?(?:optional|not required)/i,
    phrase: 'reviews suggest attendance is flexible',
  },
];

/**
 * One-line policy suggestion composed from hint themes, or null when the
 * hints don't support any concrete statement. Always source-prefixed.
 */
export function summarizePolicyFromHints(hints: AttendanceHint[]): string | null {
  const text = hints.map((h) => h.text).join(' ');
  const phrases = THEMES.filter((t) => t.pattern.test(text)).map((t) => t.phrase);
  if (phrases.length === 0) return null;
  return `(From PlanetTerp student reviews — verify with the syllabus) ${phrases.join('; ')}.`;
}
