// FORGE service worker — offline-first.
// v2 — bump cache version, never cache redirected/non-200 responses,
// network-first for navigation so a broken cache can self-heal.

const CACHE = 'forge-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/db.js',
  '/logic.js',
  '/components.jsx',
  '/app.jsx',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

// Only cache "fresh-from-the-server, 200 OK, not-a-redirect" responses.
// Anything else (auth pages, redirects, opaque CDN errors) is poison.
function isCacheable(res) {
  return res
    && res.status === 200
    && !res.redirected
    && (res.type === 'basic' || res.type === 'cors');
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {/* tolerate missing */}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Wipe ALL old caches, not just the previous version. Guarantees a
    // borked v1 cache from the auth-protection era cannot bleed through.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Navigation: NETWORK FIRST. If a previous deploy poisoned the shell cache,
  // a fresh fetch will overwrite it. Fall back to cached shell only when
  // truly offline.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (isCacheable(res)) {
          const c = await caches.open(CACHE);
          c.put('/index.html', res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // Same-origin assets: stale-while-revalidate, only writing CACHEABLE responses.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const network = fetch(e.request).then(async (res) => {
        if (isCacheable(res)) {
          const c = await caches.open(CACHE);
          c.put(e.request, res.clone());
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // Cross-origin (fonts, react CDN, dexie): cache-first.
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (isCacheable(res)) {
        const c = await caches.open(CACHE);
        c.put(e.request, res.clone());
      }
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});
