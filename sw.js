// Remap Tour service worker.
//
// The app opens straight from the copy saved on the phone: quick on a weak
// signal at a toll or R&R, and it works with no signal at all. A new version
// is fetched in the background, only the files that changed, each one checked
// against the fingerprint the publish script wrote into FILES. index.html
// switches to it at once when the app has just opened and nobody has touched
// it yet, and otherwise offers an Update button.
//
// Google fonts are saved on first use. The sync link is never cached.

const VERSION = '20261125-001727'; // set by scripts/stamp-web.mjs when publishing
const FILES = {"assets/AssetManifest.bin":"1f0c82ee94aa2bfa","assets/AssetManifest.bin.json":"177360de6d8ccd59","assets/FontManifest.json":"cd7e03645bc44b2d","assets/NOTICES":"62c7e52d393472a4","assets/assets/p44-logo.png":"fe91cb017fc4c36a","assets/fonts/MaterialIcons-Regular.otf":"d25860a08f204fc4","assets/packages/cupertino_icons/assets/CupertinoIcons.ttf":"3d90c370aa4cf00d","assets/shaders/ink_sparkle.frag":"2dca5ab93d4ec29e","assets/shaders/stretch_effect.frag":"ab412f07a5b9b50b","canvaskit/canvaskit.js":"7361b744487f9826","canvaskit/canvaskit.wasm":"6bdfaa51c76845c0","canvaskit/chromium/canvaskit.js":"d2aceb0e24ead163","canvaskit/chromium/canvaskit.wasm":"c2fc286476354092","contacts-helper.html":"fbc3f663db73009f","favicon-p44.png":"f5c8227f33ca66a0","flutter.js":"a483fd28f51ed2fa","flutter_bootstrap.js":"1a94133e51443716","icons/p44-192.png":"e2295514d56a445f","icons/p44-512.png":"4f317699df867f82","icons/p44-apple-touch-icon.png":"dbf717f96c50697e","icons/p44-maskable-192.png":"194020ea040cbf3a","icons/p44-maskable-512.png":"2d54bc1504b54378","icons/p44-splash.jpg":"f6277e4a02ee64b5","index.html":"6b19224abf817691","main.dart.js":"cfe97d9df3de83e9","manifest.json":"01af7c09ec9085fd","remap-contacts.apk":"6049bcb247fe3f3a","remap-contacts.apk.idsig":"a3787ca5c7669ce4"};
const PUBLISHED = !VERSION.startsWith('__');

// Saved on first install. The drawing engine this phone uses (there are two)
// and anything else the page loaded are added when the page reports them.
const CORE = [
  'index.html',
  'flutter_bootstrap.js',
  'main.dart.js',
  'manifest.json',
  'favicon-p44.png',
  'icons/p44-splash.jpg',
  'icons/p44-192.png',
  'assets/AssetManifest.bin.json',
  'assets/FontManifest.json',
  'assets/fonts/MaterialIcons-Regular.otf',
  'assets/assets/p44-logo.png',
];
const PREFIX = 'remap-tour-';
const CACHE = PREFIX + VERSION;
const LIST = '__files__'; // kept with each version's files

const urlOf = (path) => new URL(path, self.registration.scope).href;

// "main.dart.js" for a link inside the app, null for anything else.
function pathOf(href) {
  const url = new URL(href);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const path = decodeURIComponent(url.pathname.slice(scope.pathname.length));
  return path === '' ? 'index.html' : path;
}

async function fingerprint(body) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const keepable = (body, type) => new Response(body, { headers: { 'Content-Type': type || '' } });

// The file as published in this version: from the browser's own cache when it
// has this version (the page has just loaded it: no download), otherwise from
// the server. An error while the server still has another version (GitHub can
// take a minute after publishing): the worker tries again later.
async function download(path) {
  for (const mode of ['default', 'reload']) {
    const response = await fetch(urlOf(path), { cache: mode });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const body = await response.arrayBuffer();
    if (await fingerprint(body) === FILES[path]) {
      return keepable(body, response.headers.get('Content-Type'));
    }
  }
  throw new Error(`${path}: another version`);
}

async function install() {
  const cache = await caches.open(CACHE);
  const wanted = new Set(CORE.filter((path) => path in FILES));
  const saved = new Map(); // path → copies saved by earlier versions
  let fingerprinted = false;
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const old = await caches.open(name);
    if (await old.match(urlOf(LIST))) fingerprinted = true;
    for (const request of await old.keys()) {
      const path = pathOf(request.url);
      if (path && path in FILES) {
        wanted.add(path);
        saved.set(path, [...(saved.get(path) || []), { old, request }]);
      } else if (!path && /^https:\/\/fonts\.(gstatic|googleapis)\.com\//.test(request.url)) {
        const font = await old.match(request);
        if (font) await cache.put(request, font);
      }
    }
  }
  await Promise.all([...wanted].map(async (path) => {
    if (await cache.match(urlOf(path))) return; // saved by an earlier try
    // Unchanged since an earlier version: copy it, no download.
    for (const { old, request } of saved.get(path) || []) {
      const copy = await old.match(request);
      if (!copy) continue;
      const body = await copy.arrayBuffer();
      if (await fingerprint(body) === FILES[path]) {
        return cache.put(urlOf(path), keepable(body, copy.headers.get('Content-Type')));
      }
    }
    await cache.put(urlOf(path), await download(path));
  }));
  await cache.put(urlOf(LIST), new Response(JSON.stringify(FILES)));
  // First time on this phone, or replacing the older worker that had no
  // fingerprints (its pages cannot ask for the switch): take over now.
  if (!fingerprinted) self.skipWaiting();
}

self.addEventListener('install', (event) => {
  if (!PUBLISHED) {
    self.skipWaiting(); // a test build: no saving, always the newest files
    return;
  }
  event.waitUntil(install());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'update') self.skipWaiting();
  if (message.type === 'keep' && PUBLISHED) event.waitUntil(keep(message.urls || []));
});

// Saves what the page loaded and is not saved yet (from the browser's own
// cache, so usually no download).
async function keep(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map(async (href) => {
    const path = pathOf(href);
    if (!path || !(path in FILES) || await cache.match(urlOf(path))) return;
    try {
      await cache.put(urlOf(path), await download(path));
    } catch (_) {
      // Not this version's file: it is fetched again when needed.
    }
  }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !PUBLISHED) return;
  const url = new URL(request.url);
  const path = pathOf(request.url);
  if (path && path in FILES) {
    event.respondWith(saved(path, request, event));
  } else if (/^fonts\.(gstatic|googleapis)\.com$/.test(url.hostname)) {
    event.respondWith(fontFirst(request));
  }
});

async function saved(path, request, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(urlOf(path));
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil((async () => {
      try {
        const body = await copy.arrayBuffer();
        if (await fingerprint(body) === FILES[path]) {
          await cache.put(urlOf(path), keepable(body, copy.headers.get('Content-Type')));
        }
      } catch (_) {
        // Saved next time.
      }
    })());
  }
  return response;
}

async function fontFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
