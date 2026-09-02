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

/**
 * True when a "Directions" tap should open Apple Maps instead of Google
 * Maps. `Platform.OS === 'ios'` alone only catches the native app build —
 * on the web build (including the installed PWA), Platform.OS is always
 * 'web', even on an iPhone, so that check alone sends every iPhone PWA
 * user to a Google Maps *universal link* instead. That link doesn't always
 * hand off cleanly to the installed Google Maps app from inside a
 * standalone PWA context; it can land on the maps.google.com website
 * instead, and the destination gets lost if the user then switches to the
 * app manually. Apple Maps' maps.apple.com scheme is a first-party OS-level
 * handler, not a universal link needing verification, so it doesn't have
 * this failure mode — worth using whenever the device is actually an
 * iPhone/iPad, regardless of which build is running.
 */
export function prefersAppleMaps(
  platformOS: string,
  env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints' | 'platform'>,
): boolean {
  if (platformOS === 'ios') return true;
  if (platformOS !== 'web') return false;
  return isAppleTouchDevice(env);
}

/** Convenience wrapper reading `navigator` directly — trivial glue, not
 * unit-tested itself; `prefersAppleMaps` above carries the actual logic. */
export function prefersAppleMapsForCurrentDevice(platformOS: string): boolean {
  if (typeof navigator === 'undefined') return platformOS === 'ios';
  return prefersAppleMaps(platformOS, {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    platform: navigator.platform ?? '',
  });
}
