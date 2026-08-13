/**
 * PlanetTerp integration (planetterp.com/api) — free, keyless, CORS-open.
 *
 * Fetches run only when the user taps "Fetch from PlanetTerp" on a course
 * (never automatically), and results are cached in the local database so
 * everything keeps working offline afterward. Review-derived attendance
 * hints are advisory: shown with their source and only written into the
 * course's attendance-policy field when the user explicitly accepts them.
 */

import { extractAttendanceHints, summarizePolicyFromHints, type AttendanceHint, type PTReview } from '../lib/planetterpHints';

const BASE = 'https://planetterp.com/api/v1';

export interface PlanetTerpEnrichment {
  courseCode: string;
  title: string | null;
  description: string | null;
  averageGpa: number | null;
  professors: string[];
  /** Ratings for professors whose reviews were fetched. */
  professorRatings: Record<string, number>;
  hints: AttendanceHint[];
  policySuggestion: string | null;
}

export type EnrichResult =
  | { ok: true; value: PlanetTerpEnrichment }
  | { ok: false; error: string };

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`PlanetTerp returned ${res.status}`);
  return res.json();
}

/**
 * Fetch course info + reviews and mine attendance hints.
 * `preferredProfessor` (the course's saved professor, if any) is fetched
 * first; otherwise the first few professors PlanetTerp lists for the course.
 */
export async function fetchEnrichment(
  courseCode: string,
  preferredProfessor?: string,
): Promise<EnrichResult> {
  const code = courseCode.toUpperCase().replace(/\s+/g, '');
  try {
    const course = (await getJson(`/course?name=${encodeURIComponent(code)}`)) as {
      title?: string;
      description?: string;
      average_gpa?: number;
      professors?: string[];
    };

    const professors = Array.isArray(course.professors) ? course.professors : [];

    const reviews: PTReview[] = [];
    const professorRatings: Record<string, number> = {};
    const fetched = new Set<string>();
    const fetchProfessor = async (name: string) => {
      if (fetched.has(name.toLowerCase())) return;
      fetched.add(name.toLowerCase());
      try {
        const prof = (await getJson(`/professor?name=${encodeURIComponent(name)}&reviews=true`)) as {
          name?: string;
          average_rating?: number;
          reviews?: { course?: string; review?: string; rating?: number }[];
        };
        if (typeof prof.average_rating === 'number' && prof.name) {
          professorRatings[prof.name] = Math.round(prof.average_rating * 100) / 100;
        }
        for (const rv of prof.reviews ?? []) {
          reviews.push({
            professor: prof.name ?? name,
            course: rv.course ?? null,
            review: rv.review ?? '',
            rating: typeof rv.rating === 'number' ? rv.rating : null,
          });
        }
      } catch {
        // A professor lookup failing shouldn't sink the whole enrichment.
      }
    };

    // Saved professor first (best review targeting)…
    if (preferredProfessor?.trim()) {
      const wanted = preferredProfessor.trim().toLowerCase().replace(/^prof\.?\s*/i, '');
      await fetchProfessor(professors.find((p) => p.toLowerCase().includes(wanted)) ?? wanted);
    }
    // …then fall back to the course's actual roster if that yielded nothing
    // (saved name may be a nickname, TA, or not on PlanetTerp at all).
    if (reviews.length === 0) {
      for (const name of professors.slice(0, 3)) {
        await fetchProfessor(name);
      }
    }

    const hints = extractAttendanceHints(reviews, code);
    return {
      ok: true,
      value: {
        courseCode: code,
        title: course.title ?? null,
        description: course.description ?? null,
        averageGpa: typeof course.average_gpa === 'number' ? Math.round(course.average_gpa * 100) / 100 : null,
        professors,
        professorRatings,
        hints,
        policySuggestion: summarizePolicyFromHints(hints),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const offline = /network|fetch|failed/i.test(msg);
    return {
      ok: false,
      error: offline
        ? 'Could not reach PlanetTerp — check your connection and try again.'
        : `PlanetTerp lookup failed for ${code}: ${msg}`,
    };
  }
}
