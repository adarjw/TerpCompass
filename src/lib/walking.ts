/**
 * Walking-time estimates without any map API: haversine distance between
 * stored coordinates times a configurable walking speed, with a campus
 * "indirectness" factor because nobody walks in a straight line through
 * buildings. Users can override per building or per course.
 */

import type { CampusLocation, Course, WalkRecording, WalkStartPoint } from './types';

const EARTH_RADIUS_M = 6371000;
/** Paths on campus are not straight lines; 1.3x is a common planning factor. */
const ROUTE_INDIRECTNESS = 1.3;
export const DEFAULT_WALKING_SPEED_MPS = 1.35;

/**
 * Named walking-pace presets so students pick a pace instead of typing a
 * raw m/s number. Values are typical pedestrian speeds (Slow ≈ strolling
 * with a full backpack, Medium ≈ average adult pace, Fast ≈ brisk/late).
 */
export interface WalkSpeedPreset {
  id: 'slow' | 'medium' | 'fast';
  label: string;
  mps: number;
}

export const WALK_SPEED_PRESETS: WalkSpeedPreset[] = [
  { id: 'slow', label: 'Slow', mps: 1.0 },
  { id: 'medium', label: 'Medium', mps: DEFAULT_WALKING_SPEED_MPS },
  { id: 'fast', label: 'Fast', mps: 1.7 },
];

/** Which preset a stored speed matches, if any (within rounding tolerance). */
export function matchWalkSpeedPreset(mps: number): WalkSpeedPreset['id'] | null {
  const match = WALK_SPEED_PRESETS.find((p) => Math.abs(p.mps - mps) < 0.01);
  return match?.id ?? null;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export interface WalkEstimate {
  minutes: number;
  /** How the number was produced. */
  source: 'override' | 'recorded' | 'distance' | 'default';
  distanceMeters: number | null;
  /** Number of user-timed walks averaged, when source is 'recorded'. */
  sampleCount?: number;
}

/** Fallback when we have no coordinates at all: a mid-campus walk. */
export const DEFAULT_WALK_MINUTES = 12;

export function estimateWalk(
  from: { lat: number | null; lon: number | null },
  to: CampusLocation | null,
  walkingSpeedMps: number = DEFAULT_WALKING_SPEED_MPS,
): WalkEstimate {
  if (to?.walkOverrideMin != null && to.walkOverrideMin >= 0) {
    return { minutes: to.walkOverrideMin, source: 'override', distanceMeters: null };
  }
  if (
    from.lat != null &&
    from.lon != null &&
    to?.lat != null &&
    to?.lon != null
  ) {
    const meters = haversineMeters(from.lat, from.lon, to.lat, to.lon);
    const speed = walkingSpeedMps > 0 ? walkingSpeedMps : DEFAULT_WALKING_SPEED_MPS;
    const minutes = Math.max(1, Math.ceil((meters * ROUTE_INDIRECTNESS) / speed / 60));
    return { minutes, source: 'distance', distanceMeters: Math.round(meters) };
  }
  return { minutes: DEFAULT_WALK_MINUTES, source: 'default', distanceMeters: null };
}

/**
 * Average of the user's own timed walks for a specific (starting point ->
 * building) route. Matches on building name case-insensitively since
 * `toBuilding` is free text (an abbreviation or building name), not a
 * foreign key. Returns null when there's no recorded data for this route —
 * callers should fall back to estimateWalk() rather than guessing.
 */
export function averageRecordedMinutes(
  recordings: Pick<WalkRecording, 'fromLabel' | 'toBuilding' | 'minutes'>[],
  fromLabel: WalkStartPoint,
  toBuilding: string,
): { minutes: number; sampleCount: number } | null {
  const target = toBuilding.trim().toLowerCase();
  if (!target) return null;
  const matches = recordings.filter(
    (r) => r.fromLabel === fromLabel && r.toBuilding.trim().toLowerCase() === target,
  );
  if (matches.length === 0) return null;
  const total = matches.reduce((sum, r) => sum + r.minutes, 0);
  return { minutes: Math.round(total / matches.length), sampleCount: matches.length };
}

/**
 * Walking estimate that prefers the user's own recorded average for this
 * route (only for the automatic starting points 'previous_class' and
 * 'dorm' — other labels are one-off enough that we don't guess when the
 * user is currently at them) and otherwise falls back to the generic
 * distance/override/default estimate.
 */
export function estimateWalkWithRecordings(
  recordings: Pick<WalkRecording, 'fromLabel' | 'toBuilding' | 'minutes'>[],
  impliedFromLabel: 'previous_class' | 'dorm',
  toBuildingLabel: string,
  from: { lat: number | null; lon: number | null },
  to: CampusLocation | null,
  walkingSpeedMps: number = DEFAULT_WALKING_SPEED_MPS,
): WalkEstimate {
  const recorded = averageRecordedMinutes(recordings, impliedFromLabel, toBuildingLabel);
  if (recorded) {
    return {
      minutes: recorded.minutes,
      source: 'recorded',
      distanceMeters: null,
      sampleCount: recorded.sampleCount,
    };
  }
  return estimateWalk(from, to, walkingSpeedMps);
}

/**
 * When to leave: class start minus walking time minus the course's personal
 * buffer (finding the room, stairs, coffee).
 */
export function leaveAt(
  classStart: Date,
  walk: WalkEstimate,
  course: Pick<Course, 'walkingBufferMin'>,
): Date {
  const bufferMin = course.walkingBufferMin ?? 3;
  return new Date(classStart.getTime() - (walk.minutes + bufferMin) * 60000);
}

/** Deep links usable without any map SDK. */
export function mapLinks(to: CampusLocation | null, label: string) {
  if (to?.lat != null && to?.lon != null) {
    // `q` alongside `daddr` labels the destination pin with the actual
    // building name instead of leaving Apple Maps to reverse-geocode bare
    // coordinates — which, for a specific building without its own entry
    // in Apple's places database, surfaces as the whole "University of
    // Maryland" campus instead. The coordinates (and therefore the actual
    // route) are unaffected either way; only the pin's display name changes.
    const q = encodeURIComponent(label);
    return {
      apple: `http://maps.apple.com/?daddr=${to.lat},${to.lon}&q=${q}&dirflg=w`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lon}&travelmode=walking`,
    };
  }
  const q = encodeURIComponent(`${label} University of Maryland College Park`);
  return {
    apple: `http://maps.apple.com/?q=${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}

/**
 * A single "most efficient" deep link: Apple Maps on iOS (the OS default,
 * opens instantly with no app-picker), Google Maps everywhere else (Android
 * has it installed virtually universally; the URL also works as a plain web
 * fallback). No picker dialog — one tap, one destination.
 *
 * Takes the platform as a plain boolean (rather than importing react-native
 * here) so this module stays pure and testable under plain Node/Vitest.
 */
export function bestMapUrl(to: CampusLocation | null, label: string, isIOS: boolean): string {
  const links = mapLinks(to, label);
  return isIOS ? links.apple : links.google;
}
