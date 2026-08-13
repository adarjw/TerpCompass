/**
 * umd.io integration (api.umd.io) — free, keyless, CORS-open.
 *
 * PlanetTerp's course record lists every professor who has *ever* collected
 * reviews, in no useful order, so the picker was missing whoever actually
 * teaches next semester. umd.io has the live Schedule of Classes: sections
 * per term with instructor names. We pull the course's own term plus the
 * previous few fall/spring terms and let the UI put those names first.
 */

import { recentTermCodes } from '../lib/semesters';

const BASE = 'https://api.umd.io/v1';

/**
 * Unique instructor names for a course, most-relevant first: the course's
 * own term, then each previous term. Failures (offline, unknown course,
 * term not yet published) simply contribute nothing — this is an ordering
 * hint, never a gate.
 */
export async function fetchRecentInstructors(
  courseCode: string,
  semesterStartISO: string,
  termCount = 3,
): Promise<string[]> {
  const code = courseCode.toUpperCase().replace(/\s+/g, '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of recentTermCodes(semesterStartISO, termCount)) {
    try {
      const res = await fetch(
        `${BASE}/courses/${encodeURIComponent(code)}/sections?semester=${term}&per_page=100`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) continue;
      const sections = (await res.json()) as { instructors?: string[] }[];
      if (!Array.isArray(sections)) continue;
      for (const section of sections) {
        for (const name of section.instructors ?? []) {
          const trimmed = String(name).trim();
          if (!trimmed || /instructor:?\s*tba/i.test(trimmed)) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(trimmed);
        }
      }
    } catch {
      // Term lookup failing shouldn't sink the enrichment.
    }
  }
  return out;
}
