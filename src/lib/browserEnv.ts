/**
 * Detects mobile Safari not yet installed to the Home Screen, so the web
 * app can offer the Share -> Add to Home Screen tip only where that flow
 * actually exists. Desktop Safari has a different install path ("Add to
 * Dock"), and every other mobile browser's UA also contains the literal
 * string "Safari" (a legacy compatibility token), so both must be excluded
 * explicitly rather than just checking for the word.
 *
 * iOS also has a second case worth detecting separately: Chrome/Firefox/Edge
 * on iPhone all use Apple's required WebKit engine under the hood, but their
 * Add to Home Screen (where it exists at all) doesn't grant the same Web
 * Push capability Safari's does — a student on iPhone Chrome needs to be
 * told to open the app in Safari first, not shown Safari-specific Share
 * instructions that don't match what's on their screen.
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

/** iPhone/iPod, or an iPad reporting the desktop-Mac UA that iPadOS 13+ uses (touch points is the only signal that distinguishes it from a real Mac). */
export function isAppleTouchDevice(env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints' | 'platform'>): boolean {
  return /iP(hone|od)/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}

function isSafariEngine(userAgent: string): boolean {
  return /Safari/i.test(userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(userAgent);
}

export function isMobileSafari(env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints' | 'platform'>): boolean {
  return isAppleTouchDevice(env) && isSafariEngine(env.userAgent);
}

export function shouldOfferAddToHomeScreen(env: BrowserEnv): boolean {
  return isMobileSafari(env) && !env.isStandalone;
}

/** iPhone/iPad running a non-Safari browser, not yet installed — needs to be
 * told to switch to Safari before Add to Home Screen will do anything useful. */
export function shouldOfferSafariRedirect(env: BrowserEnv): boolean {
  return isAppleTouchDevice(env) && !isSafariEngine(env.userAgent) && !env.isStandalone;
}
