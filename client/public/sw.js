const CACHE = 'alima-notes-v1';

// App shell assets to pre-cache on install
const PRECACHE = ['/'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Remove old caches from previous versions
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept: API calls, WebSocket upgrades, cross-origin requests
  if (
    e.request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname === '/ws' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Hashed static assets (JS/CSS bundles) → cache-first
  if (url.pathname.match(/\/assets\/.+\.(js|css)$/)) {
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((res) => {
            caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // HTML / navigation → network-first so updates are picked up immediately,
  // fall back to cache if offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
