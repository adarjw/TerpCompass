/**
 * Parser for Testudo's public Schedule of Classes sections HTML
 * (app.testudo.umd.edu/soc/<term>/sections?courseIds=CODE).
 *
 * The registrar's own data is the ground truth for who teaches each
 * section — third-party mirrors (umd.io) can lag behind and miss
 * recently-assigned instructors. Only two token kinds matter, and they
 * appear in document order: a section id span, then that section's
 * instructor spans.
 */

export interface SocSections {
  /** Instructors per section number, e.g. { "0506": ["Hailu Gebremariam"] }. */
  bySection: Record<string, string[]>;
  /** Unique instructors across all sections, in document order. */
  all: string[];
}

const TOKEN_RE =
  /<span class="section-id">\s*([^<]+?)\s*<\/span>|<span class="section-instructor">([^<]+)<\/span>/g;

export function parseSocSections(html: string): SocSections {
  const bySection: Record<string, string[]> = {};
  const all: string[] = [];
  const seen = new Set<string>();
  let currentSection: string | null = null;

  const scan = new RegExp(TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html)) !== null) {
    if (m[1] != null) {
      currentSection = m[1].trim();
      if (currentSection && !bySection[currentSection]) bySection[currentSection] = [];
      continue;
    }
    const name = decodeEntities(m[2].trim());
    if (!name || /instructor:?\s*tba|^tba$|^staff$/i.test(name)) continue;
    if (currentSection) bySection[currentSection].push(name);
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      all.push(name);
    }
  }
  return { bySection, all };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
