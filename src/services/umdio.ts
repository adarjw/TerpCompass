/**
 * Instructor lookup: Testudo Schedule of Classes first (registrar ground
 * truth, via services/soc), umd.io as fallback (free mirror; can lag and
 * miss recently-assigned instructors, but works from local dev where the
 * Testudo proxy path doesn't exist).
 */

import { recentTermCodes, umdTermCode } from '../lib/semesters';
import { fetchSocSections } from './soc';

const UMDIO = 'https://api.umd.io/v1';

async function umdioTermInstructors(code: string, term: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${UMDIO}/courses/${encodeURIComponent(code)}/sections?semester=${term}&per_page=100`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const sections = (await res.json()) as { instructors?: string[] }[];
    if (!Array.isArray(sections)) return [];
    const out: string[] = [];
    for (const section of sections) {
      for (const name of section.instructors ?? []) {
        const trimmed = String(name).trim();
        if (trimmed && !/instructor:?\s*tba|^tba$|^staff$/i.test(trimmed)) out.push(trimmed);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Unique instructor names for a course, most-relevant first: the course's
 * own term, then each previous term. Per term, Testudo is authoritative;
 * umd.io fills in only when Testudo yielded nothing. Failures simply
 * contribute nothing — this is an ordering hint, never a gate.
 */
export async function fetchRecentInstructors(
  courseCode: string,
  semesterStartISO: string,
  termCount = 3,
): Promise<string[]> {
  const code = courseCode.toUpperCase().replace(/\s+/g, '');
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const term of recentTermCodes(semesterStartISO, termCount)) {
    const soc = await fetchSocSections(code, term);
    const names = soc?.all.length ? soc.all : await umdioTermInstructors(code, term);
    names.forEach(add);
  }
  return out;
}

/**
 * Who teaches one specific section (from a scanned "PHYS 260 (0506)") in
 * the course's own term. Registrar data first, umd.io fallback. Returns
 * null when the section can't be found or has no named instructor yet.
 */
export async function fetchSectionProfessor(
  courseCode: string,
  semesterStartISO: string,
  section: string,
): Promise<string | null> {
  const code = courseCode.toUpperCase().replace(/\s+/g, '');
  const term = umdTermCode(semesterStartISO);
  if (!term) return null;

  const soc = await fetchSocSections(code, term);
  const socNames = soc?.bySection[section];
  if (socNames && socNames.length > 0) return socNames.join(', ');

  try {
    const res = await fetch(
      `${UMDIO}/courses/${encodeURIComponent(code)}/sections?semester=${term}&per_page=100`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const sections = (await res.json()) as { number?: string; instructors?: string[] }[];
    if (!Array.isArray(sections)) return null;
    const match = sections.find((s) => String(s.number ?? '').trim() === section);
    const names = (match?.instructors ?? [])
      .map((n) => String(n).trim())
      .filter((n) => n && !/instructor:?\s*tba|^tba$|^staff$/i.test(n));
    return names.length > 0 ? names.join(', ') : null;
  } catch {
    return null;
  }
}
