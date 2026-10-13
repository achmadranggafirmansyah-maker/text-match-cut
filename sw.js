/* ============================================================
   Text Match Cut — Service Worker
   Strategy: Cache-first for app shell, stale-while-revalidate for CDN.
   ============================================================ */

const CACHE_VERSION = 'tmc-v1.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

/* ---- Install: pre-cache app shell ---- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---- Activate: clean old caches ---- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---- Fetch: smart caching ---- */
self.addEventListener('fetch', function (event) {
  const req = event.request;

  /* Only GET, only http(s) */
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  /* Never cache the service worker itself or devtools requests */
  if (url.pathname.endsWith('/sw.js')) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isAppShell = isSameOrigin && (
    url.pathname === new URL('./', self.location).pathname ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/manifest.json')
  );

  /* ---- Strategy A: App shell → cache-first, network fallback ---- */
  if (isAppShell) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) {
          /* Refresh in background */
          fetch(req).then(function (res) {
            if (res && res.status === 200) {
              caches.open(CACHE_VERSION).then(function (c) { c.put(req, res.clone()); });
            }
          }).catch(function () {});
          return cached;
        }
        return fetch(req).then(function (res) {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, clone); });
          }
          return res;
        }).catch(function () {
          /* Offline fallback */
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* ---- Strategy B: Everything else (CDN fonts, Tailwind) → stale-while-revalidate ---- */
  event.respondWith(
    caches.match(req).then(function (cached) {
      const networkFetch = fetch(req).then(function (res) {
        /* Cache only successful + basic/cors responses (skip opaque errors) */
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, clone); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        /* Network failed → if we have cache, use it (already returned below) */
        return cached;
      });

      /* Return cached immediately if available; otherwise wait for network */
      return cached || networkFetch;
    })
  );
});

/* ---- Message channel: allow manual skip waiting from app ---- */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
