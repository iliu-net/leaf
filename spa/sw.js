/* sw.js — Leaf PWA Service Worker */

// Derive the base path from the SW's own URL so the app works
// correctly regardless of install path (e.g. /v6/spa/, /, /notes/).
// self.location.pathname = '/v6/spa/sw.js' → base = '/v6/spa'
const BASE  = self.location.pathname.replace(/\/sw\.js$/, '');
const CACHE = 'leaf-v1';

const SHELL = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/css/app.css`,
  `${BASE}/js/app.js`,
  `${BASE}/js/notes.js`,
  `${BASE}/js/auth.js`,
  `${BASE}/js/db.js`,
  `${BASE}/js/sync.js`,
  `${BASE}/js/store.js`,
  `${BASE}/js/ui.js`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.svg`,
  `${BASE}/icons/icon-512.svg`,
];

// Dexie core from CDN — cached so the app works fully offline
const CDN = [
  'https://unpkg.com/dexie@3/dist/dexie.js',
];

// ── Install: pre-cache app shell + Dexie ─────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...SHELL, ...CDN]))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API, sync, and auth calls → network only, never cached
  if (
    url.pathname.endsWith('api.php')  ||
    url.pathname.endsWith('sync.php') ||
    url.pathname.endsWith('auth.php')
  ) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline', changes: [], currentRevision: null }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Everything else → cache first, fall back to network, update cache
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

// ── Background sync hook (reserved for future use) ────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-notes') {
    console.log('[SW] Background sync triggered');
  }
});
