// Remap Tour service worker: the app opens without signal, and picks up a
// new version the next time it opens with signal.
//
// App files: network first (so an update arrives straight away), falling
// back to the copy saved on the phone after a few seconds or when offline.
// Fonts from Google: saved on first use. The sync link is never cached.

const VERSION = '20261118-015018'; // replaced by scripts/deploy-web.ps1
const CACHE = 'remap-tour-' + VERSION;
const CORE = [
  './',
  'index.html',
  'flutter_bootstrap.js',
  'main.dart.js',
  'manifest.json',
  'favicon-p44.png',
  'icons/p44-192.png',
  'icons/p44-512.png',
  'icons/p44-apple-touch-icon.png',
  'assets/assets/p44-logo.png',
  'assets/AssetManifest.bin.json',
  'assets/FontManifest.json',
  'assets/fonts/MaterialIcons-Regular.otf',
  'canvaskit/canvaskit.js',
  'canvaskit/canvaskit.wasm',
  'canvaskit/chromium/canvaskit.js',
  'canvaskit/chromium/canvaskit.wasm',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(CORE.map((url) => cache.add(url).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('remap-tour-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (/^fonts\.(gstatic|googleapis)\.com$/.test(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  // Ask the server whether the file changed (a quick check when it did not).
  const fresh = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
  if (!saved) return fresh;
  // Weak signal at a toll or R&R: use the saved copy after 4 seconds.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), 4000));
  try {
    return await Promise.race([fresh, timeout]);
  } catch (_) {
    return saved;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
