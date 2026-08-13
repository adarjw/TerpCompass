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
import { fetchRecentInstructors } from './umdio';

const BASE = 'https://planetterp.com/api/v1';

export interface PlanetTerpEnrichment {
  courseCode: string;
  title: string | null;
  description: string | null;
  averageGpa: number | null;
  professors: string[];
  /**
   * Who actually teaches the course in its own term and the few terms
   * before it (from umd.io's Schedule of Classes), newest term first.
   * Empty when the course's semester wasn't known or umd.io was down.
   */
  currentInstructors: string[];
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
 * first; otherwise professors teaching in recent terms (umd.io), then the
 * first few PlanetTerp lists for the course.
 * `semesterStart` (the course's start date) enables the umd.io lookup of
 * who teaches that term and the few terms before it.
 */
export async function fetchEnrichment(
  courseCode: string,
  preferredProfessor?: string,
  semesterStart?: string,
): Promise<EnrichResult> {
  const code = courseCode.toUpperCase().replace(/\s+/g, '');
  try {
    const course = (await getJson(`/course?name=${encodeURIComponent(code)}`)) as {
      title?: string;
      description?: string;
      average_gpa?: number;
      professors?: string[];
    };

    // Dedupe PlanetTerp's roster (it repeats names across terms).
    const professors: string[] = [];
    const rosterSeen = new Set<string>();
    for (const name of Array.isArray(course.professors) ? course.professors : []) {
      const key = name.trim().toLowerCase();
      if (!key || rosterSeen.has(key)) continue;
      rosterSeen.add(key);
      professors.push(name.trim());
    }

    const currentInstructors = semesterStart
      ? await fetchRecentInstructors(code, semesterStart)
      : [];

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
    // …then whoever actually teaches it in recent terms, then the general
    // roster (saved name may be a nickname, TA, or not on PlanetTerp).
    if (reviews.length === 0) {
      for (const name of [...currentInstructors, ...professors].slice(0, 3)) {
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
        currentInstructors,
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
