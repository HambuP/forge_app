// FORGE service worker — offline-first.
// Cache versioning: bump CACHE on any deploy so stale assets get evicted.

const CACHE = 'forge-v1';
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

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {/* tolerate missing files */}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // For navigation requests, serve the cached shell (SPA fallback).
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/index.html').then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // Stale-while-revalidate for app shell + same-origin assets.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const network = fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (fonts, react CDN, dexie): cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok && res.type === 'basic' || res.type === 'cors') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
