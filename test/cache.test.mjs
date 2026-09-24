/**
 * The browser cache stores JSON. Anything that is not plain JSON – a Map, a
 * Date, a timestamp that must be fresh – has to be rebuilt after a cache read,
 * not stored. These tests exercise the second call, which is the one that
 * reads from the cache.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeWeatherPayload, makeOverpassPayload, overpassPartFor } from './fixtures.mjs';

// A minimal localStorage, installed before the modules that use it run.
class MemoryStorage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
  clear() { this.#items.clear(); }
}
globalThis.localStorage = new MemoryStorage();

let calls = [];
/** Which Overpass halves should fail, by part name. */
let failing = new Set();

globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('open-meteo')) {
    calls.push('weather');
    return { ok: true, status: 200, json: async () => makeWeatherPayload() };
  }

  const part = overpassPartFor(options.body?.get?.('data') ?? '');
  calls.push(`overpass:${part}`);
  if (failing.has(part)) {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    throw error;
  }
  return { ok: true, status: 200, json: async () => makeOverpassPayload({ part }) };
};

const { fetchWeather, normaliseWeather } = await import('../src/weather.js');
const { fetchSpots } = await import('../src/spots.js');
const { scoreHours } = await import('../src/score.js');
const { cache, CACHE_VERSION } = await import('../src/util.js');

const weatherKey = (lat, lon) => `kalaonni:weather:${CACHE_VERSION}:${lat}:${lon}`;

test('a cached forecast is still usable, not a hollow JSON copy', async () => {
  localStorage.clear();
  calls = [];

  const first = await fetchWeather(61.4978, 23.761);
  assert.equal(calls.length, 1);
  assert.ok(first.sunByDate instanceof Map, 'first read must expose a Map');

  const second = await fetchWeather(61.4978, 23.761);
  assert.equal(calls.length, 1, 'the second call must be served from the cache');
  assert.ok(second.sunByDate instanceof Map, 'a cached read must rebuild the Map');
  assert.ok(second.sunByDate.get(second.days[0].dateKey), 'sunrise lookup must work after a cache read');

  // The whole point: scoring a cached forecast must not throw.
  const fromCache = scoreHours(second);
  assert.equal(fromCache.length, scoreHours(first).length);
  assert.deepEqual(fromCache.map((e) => e.score), scoreHours(first).map((e) => e.score));
});

test('the cached forecast keeps a fresh "now", not the one it was stored with', async () => {
  localStorage.clear();
  const first = await fetchWeather(60.1, 24.9);
  const stored = JSON.parse(localStorage.getItem(weatherKey('60.10', '24.90')));
  assert.ok(stored.value.hourly, 'the raw payload is what gets stored');
  assert.equal(stored.value.nowIso, undefined, 'derived values must not be stored');

  const second = await fetchWeather(60.1, 24.9);
  assert.match(second.nowIso, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.equal(second.nowIso, first.nowIso.slice(0, 13));
});

test('cached spots parse back into sorted, measured spots', async () => {
  localStorage.clear();
  calls = [];
  failing = new Set();

  const first = await fetchSpots(61.4978, 23.761, 10);
  assert.equal(calls.length, 2, 'the two halves are asked separately');
  assert.equal(first.partial, false);

  const second = await fetchSpots(61.4978, 23.761, 10);
  assert.equal(calls.length, 2, 'the second call must be served from the cache');
  assert.deepEqual(second.spots.map((s) => s.id), first.spots.map((s) => s.id));
  assert.ok(second.spots.every((spot) => Number.isFinite(spot.distanceKm)));
  assert.ok(second.spots[0].isFishingSpot, 'marked fishing spots stay first');
});

test('the fast half is shown even when the water search fails', async () => {
  localStorage.clear();
  calls = [];
  failing = new Set(['water']);

  const partialSpots = [];
  const result = await fetchSpots(61.4978, 23.761, 10, {
    onPartial: (spots) => partialSpots.push(spots),
  });

  assert.ok(result.spots.length > 0, 'a failing half must not empty the list');
  assert.ok(result.spots.some((spot) => spot.name === 'Kaupin kalastuslaituri'));
  assert.equal(result.partial, true);
  assert.equal(result.failures[0].name, 'vesistöt');
  assert.equal(result.failures[0].reason, 'haku kesti liian kauan',
    'an abort must be reported as a timeout, not as a raw fetch error');
  assert.ok(partialSpots.length >= 1, 'marked spots are rendered before the slow half returns');
});

test('a total failure falls back to whatever the cache still holds', async () => {
  localStorage.clear();
  calls = [];
  failing = new Set();
  await fetchSpots(61.4978, 23.761, 10);          // warm the cache

  // Age both entries past the TTL and make every request fail.
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key.includes(':spots:')) continue;
    const entry = JSON.parse(localStorage.getItem(key));
    entry.savedAt = Date.now() - 9 * 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(entry));
  }
  failing = new Set(['spots', 'water']);

  const result = await fetchSpots(61.4978, 23.761, 10);
  assert.ok(result.spots.length > 0, 'stale spots beat an empty list at the shore');
  assert.equal(result.stale, true);
  assert.ok(result.staleAgeMs > 8 * 60 * 60 * 1000);
});

test('with nothing cached, a total failure explains itself in Finnish', async () => {
  localStorage.clear();
  failing = new Set(['spots', 'water']);

  await assert.rejects(
    () => fetchSpots(62.1, 25.5, 10),
    (error) => {
      assert.match(error.message, /Kalapaikkojen haku ei onnistunut/);
      assert.match(error.message, /haku kesti liian kauan/);
      assert.match(error.message, /pienennä hakusädettä/);
      assert.ok(!/abort/i.test(error.message), 'no raw English fetch errors for the reader');
      return true;
    },
  );
});

test('an entry written in an older shape is replaced, not trusted', async () => {
  localStorage.clear();
  calls = [];

  // What the previous version stored: the normalised object, whose Map and
  // timestamps did not survive JSON.
  const poisoned = JSON.parse(JSON.stringify(normaliseWeather(makeWeatherPayload())));
  assert.ok(!(poisoned.sunByDate instanceof Map), 'the poisoned entry is the broken shape');
  localStorage.setItem(
    weatherKey('61.50', '23.76'),
    JSON.stringify({ savedAt: Date.now(), value: poisoned }),
  );

  const weather = await fetchWeather(61.4978, 23.761);
  assert.equal(calls.length, 1, 'an unreadable entry must trigger a fresh fetch');
  assert.ok(weather.sunByDate instanceof Map);
  assert.doesNotThrow(() => scoreHours(weather));
});

test('prune clears stale cache entries and nothing else', () => {
  localStorage.clear();
  localStorage.setItem('kalaonni:weather:61.50:23.76', '{}');          // pre-version cache
  localStorage.setItem('kalaonni:spots:61.500:23.761:10', '{}');       // pre-version cache
  localStorage.setItem(weatherKey('61.50', '23.76'), '{}');            // current cache
  localStorage.setItem('kalaonni:theme', 'dark');                      // a preference
  localStorage.setItem('kalaonni:filters', '["jarvi"]');               // a preference
  localStorage.setItem('muu-sovellus:avain', '{}');                    // not ours

  const removed = cache.prune();
  assert.equal(removed, 2);
  assert.equal(localStorage.getItem('kalaonni:weather:61.50:23.76'), null);
  assert.equal(localStorage.getItem('kalaonni:spots:61.500:23.761:10'), null);
  assert.ok(localStorage.getItem(weatherKey('61.50', '23.76')));
  // Preferences are not cache: pruning them would silently reset the app.
  assert.equal(localStorage.getItem('kalaonni:theme'), 'dark');
  assert.equal(localStorage.getItem('kalaonni:filters'), '["jarvi"]');
  assert.ok(localStorage.getItem('muu-sovellus:avain'), 'other apps are left alone');
});

test('spots are re-measured from where the user is, keeping their order', async () => {
  const { recomputeDistances } = await import('../src/spots.js');
  const spots = [
    { id: 'a', lat: 61.50, lon: 23.76, distanceKm: 0.2 },
    { id: 'b', lat: 61.55, lon: 23.80, distanceKm: 5.8 },
  ];
  const moved = recomputeDistances(spots, { lat: 61.55, lon: 23.80 });

  assert.deepEqual(moved.map((s) => s.id), ['a', 'b'], 'the order must not jump around while walking');
  assert.ok(moved[0].distanceKm > spots[0].distanceKm, 'the first spot is now further away');
  assert.ok(moved[1].distanceKm < 0.01, 'the second one is underfoot');
  assert.equal(spots[0].distanceKm, 0.2, 'the originals are left alone');
  assert.equal(recomputeDistances(spots, null), spots, 'without a position nothing changes');
});

test('a new search is offered once the map no longer shows the searched area', async () => {
  const { hasPannedAway } = await import('../src/util.js');
  const origin = { lat: 61.4978, lon: 23.761 };

  assert.equal(hasPannedAway(origin, origin, 10), false);
  assert.equal(hasPannedAway({ lat: 61.51, lon: 23.78 }, origin, 10), false, 'a nudge is not a pan');
  assert.equal(hasPannedAway({ lat: 61.58, lon: 23.90 }, origin, 10), true);

  // With a small radius even a short pan leaves the searched area behind,
  // but never below the half-kilometre floor.
  assert.equal(hasPannedAway({ lat: 61.5020, lon: 23.7650 }, origin, 5), false);
  assert.equal(hasPannedAway({ lat: 61.5300, lon: 23.8000 }, origin, 5), true);
  assert.equal(hasPannedAway(null, origin, 10), false);
  assert.equal(hasPannedAway(origin, null, 10), false);
});
