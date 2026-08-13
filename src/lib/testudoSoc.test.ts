import { describe, expect, it } from 'vitest';
import { parseSocSections } from './testudoSoc';

/** Trimmed real structure from app.testudo.umd.edu/soc/<term>/sections. */
const SOC_HTML = `
<div class="section delivery-f2f">
  <input type="hidden" name="sectionId" value="0506" />
  <span class="section-id"> 0506 </span>
  <span class="section-instructors">
    <span class="section-instructor">Hailu Gebremariam</span>
  </span>
</div>
<div class="section delivery-f2f">
  <span class="section-id"> 0201 </span>
  <span class="section-instructor">Instructor: TBA</span>
</div>
<div class="section delivery-f2f">
  <span class="section-id"> 0301 </span>
  <span class="section-instructor">Michelle Girvan</span>
  <span class="section-instructor">Wendell Hill</span>
</div>
<div class="section delivery-f2f">
  <span class="section-id"> 0302 </span>
  <span class="section-instructor">Michelle Girvan</span>
</div>`;

describe('parseSocSections', () => {
  const result = parseSocSections(SOC_HTML);

  it('maps each section number to its instructors', () => {
    expect(result.bySection['0506']).toEqual(['Hailu Gebremariam']);
    expect(result.bySection['0301']).toEqual(['Michelle Girvan', 'Wendell Hill']);
    expect(result.bySection['0302']).toEqual(['Michelle Girvan']);
  });

  it('filters TBA and leaves that section empty', () => {
    expect(result.bySection['0201']).toEqual([]);
  });

  it('collects unique instructors in document order', () => {
    expect(result.all).toEqual(['Hailu Gebremariam', 'Michelle Girvan', 'Wendell Hill']);
  });

  it('decodes HTML entities in names', () => {
    const r = parseSocSections(
      '<span class="section-id">0101</span><span class="section-instructor">Conor O&#39;Brien</span>',
    );
    expect(r.all).toEqual(["Conor O'Brien"]);
  });

  it('returns empty structures for non-SOC HTML (dev-server fallback page)', () => {
    const r = parseSocSections('<!doctype html><html><body>app shell</body></html>');
    expect(r.all).toEqual([]);
    expect(Object.keys(r.bySection)).toEqual([]);
  });
});
