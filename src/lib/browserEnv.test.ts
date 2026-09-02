import { describe, expect, it } from 'vitest';
import {
  isMobileSafari,
  prefersAppleMaps,
  shouldOfferAddToHomeScreen,
  shouldOfferSafariRedirect,
} from './browserEnv';

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

describe('shouldOfferSafariRedirect', () => {
  it('offers it for iPhone Chrome, not yet installed', () => {
    expect(
      shouldOfferSafariRedirect({ userAgent: IPHONE_CHROME, maxTouchPoints: 5, platform: 'iPhone', isStandalone: false }),
    ).toBe(true);
  });

  it('does not offer it for iPhone Safari (the Add to Home Screen tip covers that case)', () => {
    expect(
      shouldOfferSafariRedirect({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, platform: 'iPhone', isStandalone: false }),
    ).toBe(false);
  });

  it('does not offer it once already installed to the Home Screen', () => {
    expect(
      shouldOfferSafariRedirect({ userAgent: IPHONE_CHROME, maxTouchPoints: 5, platform: 'iPhone', isStandalone: true }),
    ).toBe(false);
  });

  it('does not offer it on Android', () => {
    expect(
      shouldOfferSafariRedirect({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, platform: 'Linux armv8l', isStandalone: false }),
    ).toBe(false);
  });
});

describe('prefersAppleMaps', () => {
  it('is true on the native iOS build regardless of device signals', () => {
    expect(prefersAppleMaps('ios', { userAgent: '', maxTouchPoints: 0, platform: '' })).toBe(true);
  });

  it('is true on the web build running on an iPhone', () => {
    // Regression: Platform.OS === 'ios' alone never catches this case,
    // since Platform.OS is always 'web' on the web build (including the
    // installed PWA) even when the device is an iPhone — the app was
    // sending iPhone PWA users to a Google Maps universal link that could
    // fail to hand off to the installed app cleanly.
    expect(
      prefersAppleMaps('web', { userAgent: IPHONE_SAFARI, maxTouchPoints: 5, platform: 'iPhone' }),
    ).toBe(true);
  });

  it('is true on the web build running on an iPhone with a non-Safari browser', () => {
    expect(
      prefersAppleMaps('web', { userAgent: IPHONE_CHROME, maxTouchPoints: 5, platform: 'iPhone' }),
    ).toBe(true);
  });

  it('is false on the web build running on Android', () => {
    expect(
      prefersAppleMaps('web', { userAgent: ANDROID_CHROME, maxTouchPoints: 5, platform: 'Linux armv8l' }),
    ).toBe(false);
  });

  it('is false on the native android build', () => {
    expect(prefersAppleMaps('android', { userAgent: '', maxTouchPoints: 0, platform: '' })).toBe(false);
  });
});
