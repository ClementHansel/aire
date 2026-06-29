/**
 * AIRE Operations Platform — Service Worker
 *
 * Provides offline caching for PWA installability and resilience.
 * Requirements: 5.3, 39.1, 39.2, 39.3, 39.4
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS): Cache-first with network fallback
 *   - API requests: Network-first with cache fallback (for GET only)
 *   - Service catalog/pricing: Stale-while-revalidate for offline menu visibility
 */

const CACHE_NAME = 'aire-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests: network-first (GET only)
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET') {
      event.respondWith(networkFirstStrategy(request));
    }
    return;
  }

  // Static assets & app shell: cache-first
  event.respondWith(cacheFirstStrategy(request));
});

// ─── Strategies ──────────────────────────────────────────────────────────────

async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline fallback if available
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(
      JSON.stringify({ error: 'offline', message: 'You are offline' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
