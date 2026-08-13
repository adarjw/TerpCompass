const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web build loads its SQLite engine as a .wasm asset.
config.resolver.assetExts.push('wasm');

// SharedArrayBuffer (used by the wasm SQLite engine) requires cross-origin
// isolation headers on web.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return middleware(req, res, next);
  };
};

module.exports = config;
