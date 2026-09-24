/**
 * The catch log and the user's own places are the only data in this app that
 * cannot be fetched again, so these tests are about not losing it.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  #items = new Map();
  #failWrites = false;
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) {
    if (this.#failWrites) throw new Error('QuotaExceededError');
    this.#items.set(key, String(value));
  }
  removeItem(key) { this.#items.delete(key); }
  clear() { this.#items.clear(); }
  failWrites(on) { this.#failWrites = on; }
}
globalThis.localStorage = new MemoryStorage();

const { readList, writeList, exportAll, importAll } = await import('../src/store.js');
const logbook = await import('../src/logbook.js');
const { cache } = await import('../src/util.js');

const PIER = { id: 'node/103', name: 'Kaupin laituri', lat: 61.5058, lon: 23.741 };

beforeEach(() => {
  localStorage.clear();
  localStorage.failWrites(false);
});

test('a corrupt or missing entry reads as an empty list, never a crash', () => {
  assert.deepEqual(readList('catches'), []);
  localStorage.setItem('kalaonni:catches:v1', '{ not json');
  assert.deepEqual(readList('catches'), []);
  localStorage.setItem('kalaonni:catches:v1', '"a string"');
  assert.deepEqual(readList('catches'), [], 'a non-list must not be handed back as one');
});

test('a refused write is reported instead of being swallowed', () => {
  localStorage.failWrites(true);
  assert.equal(writeList('places', [{ id: 'x' }]), false);
  const { saved } = logbook.addPlace({ name: 'Apaja', lat: 61.5, lon: 23.7 });
  assert.equal(saved, false, 'the caller has to know the place was not stored');
});

test('own places round-trip and can be removed', () => {
  const { place, saved } = logbook.addPlace({ name: '  Salainen apaja ', lat: 61.5, lon: 23.7, note: 'kivikko' });
  assert.equal(saved, true);
  assert.equal(place.name, 'Salainen apaja', 'the name is trimmed');
  assert.match(place.id, /^oma\//);

  logbook.addPlace({ name: '', lat: 61.4, lon: 23.6 });
  const places = logbook.listPlaces();
  assert.equal(places.length, 2);
  assert.equal(places[0].name, 'Oma paikka', 'a nameless place still gets a name');
  assert.equal(places[1].name, 'Salainen apaja', 'newest first');

  logbook.removePlace(place.id);
  assert.equal(logbook.listPlaces().length, 1);
});

test('own places arrive in the shape the map already understands', () => {
  logbook.addPlace({ name: 'Apaja', lat: 61.55, lon: 23.80, waterType: 'jarvi' });
  const [spot] = logbook.placesAsSpots(logbook.listPlaces(), { lat: 61.4978, lon: 23.761 });

  assert.equal(spot.isOwnPlace, true);
  assert.equal(spot.isFishingSpot, true, 'your own place is a fishing spot by definition');
  assert.equal(spot.waterType, 'jarvi');
  assert.ok(spot.distanceKm > 5 && spot.distanceKm < 8, `distance looks wrong: ${spot.distanceKm}`);
  assert.equal(logbook.placesAsSpots([], null).length, 0);
});

test('a catch keeps the conditions it was caught in', () => {
  const { entry } = logbook.addCatch({
    speciesId: 'ahven',
    lengthCm: 28,
    method: 'Jigi',
    place: PIER,
    conditions: { score: 84, daypart: 'ilta', temp: 12, wind: 3.1 },
  });

  assert.equal(entry.speciesName, 'Ahven', 'the species name is resolved at logging time');
  assert.equal(entry.conditions.score, 84);
  assert.ok(entry.at.startsWith(new Date().getFullYear().toString()));
  assert.equal(logbook.listCatches().length, 1);

  logbook.removeCatch(entry.id);
  assert.equal(logbook.listCatches().length, 0);
});

test('catches group to a spot by id or by being close enough', () => {
  logbook.addCatch({ speciesId: 'ahven', place: PIER, conditions: { daypart: 'ilta' } });
  // Same pier, logged before it had an id (a tap on the map, 80 m away).
  logbook.addCatch({ speciesId: 'ahven', place: { name: 'kartalta', lat: 61.5065, lon: 23.7415 }, conditions: { daypart: 'ilta' } });
  // A different lake entirely.
  logbook.addCatch({ speciesId: 'hauki', place: { id: 'way/999', name: 'Muu järvi', lat: 61.9, lon: 24.4 }, conditions: { daypart: 'aamu' } });

  const here = logbook.catchesAt(PIER);
  assert.equal(here.length, 2, 'a catch 80 m away is the same place');
  assert.equal(logbook.catchesAt(null).length, 0);
});

test('a spot summary says what has been caught and when', () => {
  assert.equal(logbook.summaryForSpot(PIER), null, 'nothing to say before anything is logged');

  logbook.addCatch({ speciesId: 'ahven', lengthCm: 24, place: PIER, conditions: { daypart: 'ilta' } });
  logbook.addCatch({ speciesId: 'ahven', lengthCm: 31, place: PIER, conditions: { daypart: 'ilta' } });
  logbook.addCatch({ speciesId: 'hauki', lengthCm: 62, place: PIER, conditions: { daypart: 'aamu' } });

  const summary = logbook.summaryForSpot(PIER);
  assert.equal(summary.count, 3);
  assert.equal(summary.species[0].value, 'Ahven');
  assert.equal(summary.species[0].count, 2);
  assert.match(summary.text, /Ahven ×2/);
  assert.match(summary.text, /useimmiten iltahämärässä/);
  assert.equal(summary.biggest.lengthCm, 62);
});

test('overall stats summarise the whole log', () => {
  assert.equal(logbook.overallStats(), null);
  logbook.addCatch({ speciesId: 'ahven', lengthCm: 24, place: PIER, conditions: { daypart: 'ilta' } });
  logbook.addCatch({ speciesId: 'kuha', place: PIER, conditions: { daypart: 'yo' } });

  const stats = logbook.overallStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.biggest.lengthCm, 24, 'entries without a length do not break the biggest-fish search');
  assert.equal(stats.places[0].value, 'Kaupin laituri');
  assert.ok(stats.bestDaypartLabel);
});

test('the log survives a cache prune – it is not cache', () => {
  logbook.addPlace({ name: 'Apaja', lat: 61.5, lon: 23.7 });
  logbook.addCatch({ speciesId: 'ahven', place: PIER });
  localStorage.setItem('kalaonni:weather:61.50:23.76', '{}');   // an old cache entry

  cache.prune();

  assert.equal(logbook.listPlaces().length, 1, 'the user\'s places must never be pruned');
  assert.equal(logbook.listCatches().length, 1, 'the catch log must never be pruned');
  assert.equal(localStorage.getItem('kalaonni:weather:61.50:23.76'), null);
});

test('a backup exports and imports without duplicating', () => {
  logbook.addPlace({ name: 'Apaja', lat: 61.5, lon: 23.7 });
  logbook.addCatch({ speciesId: 'ahven', place: PIER });
  const backup = JSON.parse(JSON.stringify(exportAll(logbook.STORE_NAMES)));
  assert.equal(backup.places.length, 1);
  assert.equal(backup.catches.length, 1);

  // Importing into the same device adds nothing.
  let result = importAll(backup, logbook.STORE_NAMES);
  assert.deepEqual(result.added, { places: 0, catches: 0 });
  assert.equal(logbook.listCatches().length, 1);

  // Importing into an empty device restores everything.
  localStorage.clear();
  result = importAll(backup, logbook.STORE_NAMES);
  assert.deepEqual(result.added, { places: 1, catches: 1 });
  assert.equal(logbook.listPlaces()[0].name, 'Apaja');
  assert.equal(importAll(null, logbook.STORE_NAMES).added.places, 0, 'junk in, nothing out');
});

test('the conditions line reads as a sentence, and survives missing values', async () => {
  const { conditionsLine } = await import('../src/journal-view.js');

  assert.equal(
    conditionsLine({ score: 84, daypart: 'ilta', temp: 11.6, wind: 3.14, cloud: 82 }),
    'kalaonni 84 · iltahämärä · 12 °C · 3,1 m/s · pilvet 82 %',
  );
  assert.equal(conditionsLine({ score: 40 }), 'kalaonni 40');
  assert.equal(conditionsLine(null), 'Olosuhteita ei tallennettu');
  assert.equal(conditionsLine({}), '', 'an empty snapshot says nothing rather than inventing');
});
