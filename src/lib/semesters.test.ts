import { describe, expect, it } from 'vitest';
import { recentTermCodes, umdTermCode } from './semesters';

describe('umdTermCode', () => {
  it('maps the presets to Testudo term codes', () => {
    expect(umdTermCode('2026-08-31')).toBe('202608'); // Fall 2026
    expect(umdTermCode('2027-01-27')).toBe('202701'); // Spring 2027
    expect(umdTermCode('2027-06-01')).toBe('202705'); // Summer 2027
  });

  it('codes the winter session under the previous year', () => {
    expect(umdTermCode('2027-01-04')).toBe('202612'); // Winter 2027
  });

  it('returns empty for malformed dates', () => {
    expect(umdTermCode('soon')).toBe('');
  });
});

describe('recentTermCodes', () => {
  it('walks Fall 2026 back through the previous fall/spring terms', () => {
    expect(recentTermCodes('2026-08-31', 3)).toEqual(['202608', '202601', '202508', '202501']);
  });

  it('walks Spring 2027 back to Fall 2025', () => {
    expect(recentTermCodes('2027-01-27', 3)).toEqual(['202701', '202608', '202601', '202508']);
  });

  it('anchors winter and summer onto the surrounding majors without duplicates', () => {
    expect(recentTermCodes('2027-01-04', 2)).toEqual(['202612', '202601', '202508']);
    expect(recentTermCodes('2027-06-01', 2)).toEqual(['202705', '202608', '202601']);
  });
});
