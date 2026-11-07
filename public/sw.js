// Wordtable service worker (issue #21) — installable PWA shell with a
// versioned cache. Precaches `/` plus the manifest so the table paints
// offline; runtime GETs are cache-first same-origin, navigations fall
// back to the cached `/` shell. No push, no background sync (out of
// scope for v0.1.0). Bump CACHE on every shell change.
const CACHE = 'wordtable-v2'
const PRECACHE = ['/', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  // Network-only bypass (issue #66): never runtime-cache API-ish GETs
  // (`/health`, future `/api/*`, extensionless routes). Bare return lets
  // the browser handle the request with default networking — no
  // respondWith, no cache.put — so API responses are never served stale.
  // Only file-extension asset requests reach the runtime branch below.
  if (
    url.pathname === '/health' ||
    url.pathname.startsWith('/api/') ||
    (url.pathname !== '/' && !url.pathname.split('/').pop().includes('.'))
  ) {
    return
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
          return res
        })
        .catch(() => caches.match('/', { cacheName: CACHE })),
    )
    return
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE }).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy))
          return res
        }),
    ),
  )
})
