/**
 * Starter campus building database for UMD College Park. Coordinates are
 * approximate centroids for walking estimates only (not survey-grade), and
 * every entry is user-editable in the app. No map API involved.
 */

import type { CampusLocation } from './types';

export const UMD_BUILDINGS: Omit<CampusLocation, 'id'>[] = [
  {
    name: 'Brendan Iribe Center',
    abbreviation: 'IRB',
    lat: 38.9892,
    lon: -76.9365,
    entranceNotes: 'Main entrance faces Paint Branch Dr; lecture halls on ground floor.',
  },
  {
    name: 'A.V. Williams Building',
    abbreviation: 'AVW',
    lat: 38.9904,
    lon: -76.9367,
    entranceNotes: 'Connected to Iribe by plaza; use the courtyard entrance.',
  },
  {
    name: 'Computer Science Instructional Center',
    abbreviation: 'CSI',
    lat: 38.9899,
    lon: -76.9360,
    entranceNotes: 'Lecture halls numbered 1xxx on the ground floor.',
  },
  {
    name: 'Edward St. John Learning Center',
    abbreviation: 'ESJ',
    lat: 38.9869,
    lon: -76.9420,
    entranceNotes: 'Main doors on Campus Dr. Big TERP classrooms are downstairs.',
  },
  {
    name: 'Kirwan Hall (Math)',
    abbreviation: 'MTH',
    lat: 38.9884,
    lon: -76.9395,
    entranceNotes: 'Entrance off the mall side; room numbers wrap oddly — allow extra time.',
  },
  {
    name: 'Physics Building',
    abbreviation: 'PHY',
    lat: 38.9882,
    lon: -76.9404,
    entranceNotes: 'Lecture halls near the Toll entrance.',
  },
  {
    name: 'Chemistry Building',
    abbreviation: 'CHM',
    lat: 38.9895,
    lon: -76.9384,
  },
  {
    name: 'H.J. Patterson Hall',
    abbreviation: 'HJP',
    lat: 38.9873,
    lon: -76.9440,
  },
  {
    name: 'Jiménez Hall',
    abbreviation: 'JMZ',
    lat: 38.9861,
    lon: -76.9445,
  },
  {
    name: 'Tydings Hall',
    abbreviation: 'TYD',
    lat: 38.9846,
    lon: -76.9435,
  },
  {
    name: 'Van Munching Hall',
    abbreviation: 'VMH',
    lat: 38.9836,
    lon: -76.9469,
    entranceNotes: 'Smith School — main atrium entrance on Mowatt Ln side.',
  },
  {
    name: 'Armory',
    abbreviation: 'ARM',
    lat: 38.9853,
    lon: -76.9412,
  },
  {
    name: 'Symons Hall',
    abbreviation: 'SYM',
    lat: 38.9868,
    lon: -76.9427,
  },
  {
    name: 'Woods Hall',
    abbreviation: 'WDS',
    lat: 38.9847,
    lon: -76.9452,
  },
  {
    name: 'Skinner Building',
    abbreviation: 'SKN',
    lat: 38.9857,
    lon: -76.9401,
  },
  {
    name: 'McKeldin Library',
    abbreviation: 'MCK',
    lat: 38.9859,
    lon: -76.9450,
    entranceNotes: 'Front steps face McKeldin Mall.',
  },
  {
    name: 'Stamp Student Union',
    abbreviation: 'STAMP',
    lat: 38.9880,
    lon: -76.9445,
  },
  {
    name: 'Eppley Recreation Center',
    abbreviation: 'ERC',
    lat: 38.9935,
    lon: -76.9452,
  },
  {
    name: 'Martin Hall (Engineering)',
    abbreviation: 'EGR',
    lat: 38.9891,
    lon: -76.9379,
  },
  {
    name: 'Glenn L. Martin Wind Tunnel / Engineering Annex',
    abbreviation: 'EGL',
    lat: 38.9899,
    lon: -76.9391,
  },
  {
    name: 'Biology-Psychology Building',
    abbreviation: 'BPS',
    lat: 38.9887,
    lon: -76.9424,
  },
  {
    name: 'Hornbake Library',
    abbreviation: 'HBK',
    lat: 38.9880,
    lon: -76.9424,
  },
];

/** Match a course's free-text building against the database. */
export function findBuilding(
  buildings: CampusLocation[],
  text: string,
): CampusLocation | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return (
    buildings.find((b) => b.abbreviation.toLowerCase() === t) ??
    buildings.find((b) => b.name.toLowerCase() === t) ??
    buildings.find(
      (b) =>
        b.name.toLowerCase().includes(t) ||
        t.includes(b.abbreviation.toLowerCase() + ' ') ||
        t.startsWith(b.abbreviation.toLowerCase()),
    ) ??
    null
  );
}
