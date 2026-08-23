import { describe, expect, it } from 'vitest';
import { isMobileSafari, shouldOfferAddToHomeScreen } from './browserEnv';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_DESKTOP_SAFARI = IPAD_SAFARI_DESKTOP_UA; // identical UA; touch points is the only signal
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

describe('isMobileSafari', () => {
  it('recognizes iPhone Safari', () => {
    expect(isMobileSafari({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, platform: 'iPhone' })).toBe(true);
  });

  it('rejects iPhone Chrome (CriOS) despite the "Safari" UA token', () => {
    expect(isMobileSafari({ userAgent: IPHONE_CHROME, maxTouchPoints: 5, platform: 'iPhone' })).toBe(false);
  });

  it('recognizes iPadOS Safari, which reports a desktop-Mac UA, via touch points', () => {
    expect(isMobileSafari({ userAgent: IPAD_SAFARI_DESKTOP_UA, maxTouchPoints: 5, platform: 'MacIntel' })).toBe(true);
  });

  it('rejects real desktop Mac Safari (no touch points)', () => {
    expect(isMobileSafari({ userAgent: MAC_DESKTOP_SAFARI, maxTouchPoints: 0, platform: 'MacIntel' })).toBe(false);
  });

  it('rejects Android Chrome despite the "Safari" UA token', () => {
    expect(isMobileSafari({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, platform: 'Linux armv8l' })).toBe(false);
  });
});

describe('shouldOfferAddToHomeScreen', () => {
  it('offers the tip for mobile Safari not yet installed', () => {
    expect(
      shouldOfferAddToHomeScreen({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, platform: 'iPhone', isStandalone: false }),
    ).toBe(true);
  });

  it('does not offer it once already installed to the Home Screen', () => {
    expect(
      shouldOfferAddToHomeScreen({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, platform: 'iPhone', isStandalone: true }),
    ).toBe(false);
  });

  it('does not offer it on non-Safari browsers', () => {
    expect(
      shouldOfferAddToHomeScreen({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, platform: 'Linux armv8l', isStandalone: false }),
    ).toBe(false);
  });
});
