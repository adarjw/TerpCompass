/**
 * Fetch Testudo's public Schedule of Classes sections for a course+term.
 *
 * Testudo doesn't send CORS headers, so the web build goes through the
 * app's own origin (/soc-proxy/... — a Vercel rewrite, no server code);
 * native fetch has no CORS and calls Testudo directly. In local dev the
 * proxy path doesn't exist — the guard below notices non-SOC HTML and
 * returns null so callers fall back to umd.io.
 */

import { Platform } from 'react-native';
import { parseSocSections, type SocSections } from '../lib/testudoSoc';

export async function fetchSocSections(
  courseCode: string,
  termCode: string,
): Promise<SocSections | null> {
  const code = courseCode.toUpperCase().replace(/\s+/g, '');
  const url =
    Platform.OS === 'web'
      ? `/soc-proxy/${termCode}?courseIds=${encodeURIComponent(code)}`
      : `https://app.testudo.umd.edu/soc/${termCode}/sections?courseIds=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html.includes('section-instructor')) return null;
    const parsed = parseSocSections(html);
    return parsed.all.length > 0 || Object.keys(parsed.bySection).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
