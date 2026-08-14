/**
 * Detects mobile Safari not yet installed to the Home Screen, so the web
 * app can offer the Share -> Add to Home Screen tip only where that flow
 * actually exists. Desktop Safari has a different install path ("Add to
 * Dock"), and every other mobile browser's UA also contains the literal
 * string "Safari" (a legacy compatibility token), so both must be excluded
 * explicitly rather than just checking for the word.
 *
 * Pure and dependency-free so it's testable without a DOM; callers read the
 * actual navigator/window globals and pass them in.
 */

export interface BrowserEnv {
  userAgent: string;
  maxTouchPoints: number;
  platform: string;
  isStandalone: boolean;
}

export function isMobileSafari(env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints' | 'platform'>): boolean {
  const ua = env.userAgent;
  // iPadOS 13+ reports a desktop-Mac UA; touch points distinguish it from
  // an actual Mac.
  const isAppleTouchDevice = /iP(hone|od)/.test(ua) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
  const isSafariEngine = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(ua);
  return isAppleTouchDevice && isSafariEngine;
}

export function shouldOfferAddToHomeScreen(env: BrowserEnv): boolean {
  return isMobileSafari(env) && !env.isStandalone;
}
