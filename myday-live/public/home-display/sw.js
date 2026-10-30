// Keeps the app shell available offline so a reload during an internet outage
// still brings the display back. Photos live in IndexedDB/OPFS, not here.
// API and WebSocket traffic is never cached.
const VERSION = 'home-display-v1';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/main.js', './js/db.js', './js/blobstore.js', './js/settings.js', './js/config.js',
  './js/library.js', './js/importer.js', './js/optimize-core.js', './js/optimize-worker.js',
  './js/slideshow.js', './js/display.js', './js/modes.js', './js/cameras.js',
  './js/realtime.js', './js/sync.js', './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (sameOrigin && (url.pathname.includes('/api/') || url.pathname.endsWith('/ws'))) return;
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') {
    // Network first so updates arrive; cached shell when offline.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // Stale-while-revalidate for static assets and fonts.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
