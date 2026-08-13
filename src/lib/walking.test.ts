import { describe, expect, it } from 'vitest';
import {
  averageRecordedMinutes,
  bestMapUrl,
  estimateWalk,
  estimateWalkWithRecordings,
  haversineMeters,
  leaveAt,
} from './walking';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(38.98, -76.94, 38.98, -76.94)).toBeCloseTo(0, 3);
  });

  it('matches a rough real-world campus distance', () => {
    // Iribe to McKeldin (~1.1km straight-line on UMD's campus).
    const meters = haversineMeters(38.9892, -76.9365, 38.9859, -76.945);
    expect(meters).toBeGreaterThan(700);
    expect(meters).toBeLessThan(1400);
  });
});

describe('estimateWalk', () => {
  it('uses a manual override when present, ignoring coordinates', () => {
    const result = estimateWalk(
      { lat: 38.98, lon: -76.94 },
      { id: 'b1', name: 'B', abbreviation: 'B', lat: 39.5, lon: -77.5, walkOverrideMin: 7 },
      1.35,
    );
    expect(result.minutes).toBe(7);
    expect(result.source).toBe('override');
  });

  it('falls back to a default when no coordinates exist', () => {
    const result = estimateWalk({ lat: null, lon: null }, null, 1.35);
    expect(result.source).toBe('default');
    expect(result.minutes).toBeGreaterThan(0);
  });
});

describe('leaveAt', () => {
  it('subtracts walking time plus buffer from class start', () => {
    const start = new Date(2026, 7, 31, 10, 0);
    const leave = leaveAt(start, { minutes: 10, source: 'distance', distanceMeters: 800 }, { walkingBufferMin: 5 });
    expect(leave.getTime()).toBe(start.getTime() - 15 * 60000);
  });
});

describe('averageRecordedMinutes', () => {
  const recordings = [
    { fromLabel: 'previous_class' as const, toBuilding: 'IRB', minutes: 8 },
    { fromLabel: 'previous_class' as const, toBuilding: 'IRB', minutes: 10 },
    { fromLabel: 'dorm' as const, toBuilding: 'IRB', minutes: 15 },
    { fromLabel: 'previous_class' as const, toBuilding: 'MTH', minutes: 5 },
  ];

  it('averages only recordings matching both the starting point and destination', () => {
    const result = averageRecordedMinutes(recordings, 'previous_class', 'IRB');
    expect(result).toEqual({ minutes: 9, sampleCount: 2 });
  });

  it('matches building names case-insensitively', () => {
    const result = averageRecordedMinutes(recordings, 'previous_class', 'irb');
    expect(result?.minutes).toBe(9);
  });

  it('returns null when there is no recording for that route', () => {
    expect(averageRecordedMinutes(recordings, 'yahentamitsi', 'IRB')).toBeNull();
  });
});

describe('estimateWalkWithRecordings', () => {
  const recordings = [{ fromLabel: 'previous_class' as const, toBuilding: 'IRB', minutes: 6 }];

  it('prefers the recorded average over the generic distance estimate', () => {
    const result = estimateWalkWithRecordings(
      recordings,
      'previous_class',
      'IRB',
      { lat: 38.98, lon: -76.94 },
      { id: 'b1', name: 'Iribe', abbreviation: 'IRB', lat: 38.9892, lon: -76.9365 },
      1.35,
    );
    expect(result.source).toBe('recorded');
    expect(result.minutes).toBe(6);
  });

  it('falls back to the generic estimate when no recording exists for the route', () => {
    const result = estimateWalkWithRecordings(
      recordings,
      'dorm',
      'MTH',
      { lat: 38.98, lon: -76.94 },
      { id: 'b2', name: 'Kirwan', abbreviation: 'MTH', lat: 38.9884, lon: -76.9395 },
      1.35,
    );
    expect(result.source).toBe('distance');
  });
});

describe('bestMapUrl', () => {
  const loc = { id: 'b1', name: 'Iribe Center', abbreviation: 'IRB', lat: 38.9892, lon: -76.9365 };

  it('picks Apple Maps on iOS with no picker', () => {
    const url = bestMapUrl(loc, 'IRB', true);
    expect(url).toMatch(/^http:\/\/maps\.apple\.com\//);
  });

  it('picks Google Maps everywhere else', () => {
    const url = bestMapUrl(loc, 'IRB', false);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\//);
  });

  it('falls back to a text search when coordinates are unknown', () => {
    const url = bestMapUrl(null, 'Atlantic Building', false);
    expect(url).toContain(encodeURIComponent('Atlantic Building University of Maryland College Park'));
  });
});
