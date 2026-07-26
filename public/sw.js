/**
 * Steading Service Worker.
 *
 * Two jobs: make the shell load instantly from cold (R1), and never get in
 * the way of sync.
 *
 * The single most important rule here is that /api/sync is not touched at
 * all. Caching, retrying, or replaying a sync request from a worker would
 * duplicate mutations or reorder them behind the flush loop's back — the
 * queue owns delivery, and it is the only thing that may.
 */

const VERSION = 'v1';
const SHELL_CACHE = `steading-shell-${VERSION}`;
const DATA_CACHE = `steading-data-${VERSION}`;

/** Enough to render the app offline from a cold start. */
const SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individual failures must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept anything that changes state, and never the sync endpoint
  // under any method. Let it go straight to the network.
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/sync')) return;
  if (url.pathname.startsWith('/api/auth')) return;
  if (url.origin !== self.location.origin) return;

  // Network-first for the rest of the API: fresh when possible, last-known
  // when not.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Navigations: serve the shell immediately, revalidate behind it.
  if (request.mode === 'navigate') {
    event.respondWith(shellFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function shellFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match('/');

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put('/', response.clone());
      return response;
    })
    .catch(() => cached);

  return cached ?? network;
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Next.js fingerprints its assets, so caching them immutably is safe.
  if (response.ok && new URL(request.url).pathname.startsWith('/_next/')) {
    cache.put(request, response.clone());
  }
  return response;
}
