/**
 * The browser cache stores JSON. Anything that is not plain JSON – a Map, a
 * Date, a timestamp that must be fresh – has to be rebuilt after a cache read,
 * not stored. These tests exercise the second call, which is the one that
 * reads from the cache.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeWeatherPayload, makeOverpassPayload } from './fixtures.mjs';

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
globalThis.fetch = async (url) => {
  const href = String(url);
  calls.push(href);
  const body = href.includes('open-meteo') ? makeWeatherPayload() : makeOverpassPayload();
  return { ok: true, status: 200, json: async () => body };
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

  const first = await fetchSpots(61.4978, 23.761, 10);
  const second = await fetchSpots(61.4978, 23.761, 10);
  assert.equal(calls.length, 1, 'the second call must be served from the cache');
  assert.deepEqual(second.map((s) => s.id), first.map((s) => s.id));
  assert.ok(second.every((spot) => Number.isFinite(spot.distanceKm)));
  assert.ok(second[0].isFishingSpot, 'marked fishing spots stay first');
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

test('prune clears entries from earlier versions only', () => {
  localStorage.clear();
  localStorage.setItem('kalaonni:weather:61.50:23.76', '{}');          // pre-version key
  localStorage.setItem(weatherKey('61.50', '23.76'), '{}');            // current
  localStorage.setItem('muu-sovellus:avain', '{}');                    // not ours

  const removed = cache.prune();
  assert.equal(removed, 1);
  assert.equal(localStorage.getItem('kalaonni:weather:61.50:23.76'), null);
  assert.ok(localStorage.getItem(weatherKey('61.50', '23.76')));
  assert.ok(localStorage.getItem('muu-sovellus:avain'), 'other apps are left alone');
});
