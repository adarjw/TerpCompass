/**
 * Opens an external URL (maps, etc.), routing around a well-documented iOS
 * Safari/PWA quirk: `window.open()` — what react-native-web's
 * `Linking.openURL` calls under the hood on web (`open(url, target)` in its
 * source, ultimately `window.open(url, target, 'noopener')`) — does not
 * reliably trigger a Universal Link hand-off to an installed app (Apple
 * Maps, Google Maps). It just loads the URL as an ordinary web page in a
 * new tab, even when triggered by a genuine user tap. A real click on an
 * actual `<a>` element does trigger the hand-off correctly, so on web this
 * synthesizes one instead of going through `Linking`.
 *
 * Native builds are unaffected by any of this — `Linking.openURL` there
 * goes straight to the OS's URL-scheme dispatcher, not a browser
 * `window.open` — and keep using it unchanged.
 */

import { Linking, Platform } from 'react-native';

export function openExternalUrl(url: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    Linking.openURL(url);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
