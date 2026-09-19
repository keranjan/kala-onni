/**
 * Service worker: makes Kala-Onni installable and usable with a weak or
 * missing connection – the situation you are actually in at the shore.
 *
 * App shell  : stale-while-revalidate (instant start, updates in the background)
 * Map tiles  : cache-first with a size cap
 * Forecast & : network-first with a cache fallback, so the last known data is
 * place data   still shown offline
 */

// Bumping this drops the previous caches on activate, so a fix reaches
// installed clients on their next load instead of lingering behind a
// stale-while-revalidate copy.
const VERSION = 'kalaonni-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = `${VERSION}-tiles`;
const DATA_CACHE = `${VERSION}-data`;
const TILE_LIMIT = 400;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/vendor/leaflet/leaflet.css',
  './assets/vendor/leaflet/leaflet.js',
  './assets/vendor/leaflet/images/marker-icon.png',
  './assets/vendor/leaflet/images/marker-shadow.png',
  './src/app.js',
  './src/chart.js',
  './src/config.js',
  './src/geo.js',
  './src/map.js',
  './src/score.js',
  './src/sheet.js',
  './src/species.js',
  './src/spots.js',
  './src/ui.js',
  './src/util.js',
  './src/weather.js',
];

const DATA_HOSTS = ['api.open-meteo.com', 'nominatim.openstreetmap.org', 'overpass-api.de',
  'overpass.kumi.systems', 'overpass.private.coffee'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // One unreachable CDN file must not fail the whole install.
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;             // Overpass posts; nothing to cache

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    return;
  }
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(request, TILE_CACHE, TILE_LIMIT));
    return;
  }
  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) || (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache, limit);
  }
  return response;
}

/** Keep a cache from growing without bound; oldest entries go first. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
