/**
 * Post-build step for the web export (runs after `expo export -p web`).
 *
 * Expo's SPA output ("single") doesn't support the app/+html.tsx shell, so
 * this script patches dist/index.html directly:
 *  - title + PWA identity ("ClassCompass" on the phone home screen)
 *  - viewport-fit=cover, which exposes env(safe-area-inset-*) so the tab
 *    bar pads itself above the iPhone home indicator instead of being
 *    covered by it
 *  - apple-touch-icon / manifest / theme-color for home-screen installs
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(
  /<meta name="viewport"[^>]*\/>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
);
html = html.replace(/<title>[^<]*<\/title>/, '<title>ClassCompass</title>');

const headExtras = [
  '<meta name="description" content="Where am I supposed to be right now? UMD class compass." />',
  '<meta name="theme-color" content="#E21833" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="ClassCompass" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<link rel="apple-touch-icon" href="/icons/terpcompass-180.png" />',
  '<link rel="manifest" href="/manifest.json" />',
  // 100% height tracks the *largest* mobile-Safari viewport, so the tab bar
  // ends up behind the toolbar/home indicator. dvh tracks the visible
  // viewport dynamically and fixes the bottom of the app being clipped.
  '<style>@supports (height: 100dvh) { html, body, #root { height: 100dvh !important; } }</style>',
  // Service worker powers web-push reminders (sw.js shows them; it never
  // intercepts fetches, so the app itself stays network-served).
  "<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){});}</script>",
].join('\n    ');

html = html.replace('</head>', `    ${headExtras}\n  </head>`);

fs.writeFileSync(htmlPath, html);
console.log('inject-html: patched dist/index.html (title, viewport-fit, PWA metas)');
