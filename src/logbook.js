/**
 * The user's own places and their catch log.
 *
 * Both live only on the device. A catch carries a snapshot of the conditions
 * it was caught in, because that is what makes the log worth keeping: after a
 * season it can say that this pier gives perch at dusk.
 */

import { readList, writeList, makeId } from './store.js';
import { distanceKm } from './util.js';
import { getSpecies } from './species.js';

const PLACES = 'places';
const CATCHES = 'catches';
export const STORE_NAMES = [PLACES, CATCHES];

/** A catch logged within this distance counts as the same place. */
const SAME_PLACE_KM = 0.25;

/* ------------------------------------------------------------- places */

export const listPlaces = () => readList(PLACES);

export function addPlace({ name, lat, lon, note = '', waterType = 'tuntematon' }) {
  const place = {
    id: makeId('oma'),
    name: (name || '').trim() || 'Oma paikka',
    lat,
    lon,
    note: note.trim(),
    waterType,
    createdAt: new Date().toISOString(),
  };
  const saved = writeList(PLACES, [place, ...listPlaces()]);
  return { place, saved };
}

export function removePlace(id) {
  return writeList(PLACES, listPlaces().filter((place) => place.id !== id));
}

/**
 * Own places in the shape the map and the spot list use, so they sit among
 * the search results instead of in a world of their own.
 */
export function placesAsSpots(places, origin) {
  return places.map((place) => ({
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    waterType: place.waterType || 'tuntematon',
    isFishingSpot: true,
    isOwnPlace: true,
    note: place.note,
    facilities: place.note ? [place.note] : [],
    tags: {},
    distanceKm: origin ? distanceKm(origin, place) : 0,
  }));
}

/* ------------------------------------------------------------ catches */

export const listCatches = () => readList(CATCHES);

export function addCatch({ speciesId, lengthCm = null, method = '', note = '', place, conditions = null, at = null }) {
  const species = getSpecies(speciesId);
  const entry = {
    id: makeId('saalis'),
    at: at || new Date().toISOString(),
    speciesId,
    speciesName: species?.name || speciesId,
    lengthCm: Number.isFinite(lengthCm) ? lengthCm : null,
    method: method.trim(),
    note: note.trim(),
    place: place ? { id: place.id, name: place.name, lat: place.lat, lon: place.lon } : null,
    conditions,
  };
  const saved = writeList(CATCHES, [entry, ...listCatches()]);
  return { entry, saved };
}

export function removeCatch(id) {
  return writeList(CATCHES, listCatches().filter((entry) => entry.id !== id));
}

/** Catches logged at a spot: by id, or close enough to be the same place. */
export function catchesAt(spot, entries = listCatches()) {
  if (!spot) return [];
  return entries.filter((entry) => {
    if (!entry.place) return false;
    if (entry.place.id && entry.place.id === spot.id) return true;
    return distanceKm(entry.place, spot) <= SAME_PLACE_KM;
  });
}

const DAYPART_LABEL = {
  aamu: 'aamuhämärässä',
  paiva: 'päivällä',
  ilta: 'iltahämärässä',
  yo: 'yöllä',
};

/** Count the entries by a key, most common first. */
function tally(entries, pick) {
  const counts = new Map();
  for (const entry of entries) {
    const value = pick(entry);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

/**
 * What the log knows about one spot, in a sentence the UI can print.
 * Returns null when there is nothing to say yet.
 */
export function summaryForSpot(spot, entries = listCatches()) {
  const own = catchesAt(spot, entries);
  if (!own.length) return null;

  const species = tally(own, (entry) => entry.speciesName);
  const dayparts = tally(own, (entry) => entry.conditions?.daypart);
  const best = own.reduce((a, b) => ((b.lengthCm || 0) > (a.lengthCm || 0) ? b : a));

  const speciesText = species.slice(0, 3).map((row) => `${row.value} ×${row.count}`).join(', ');
  const whenText = dayparts.length && dayparts[0].count > 1
    ? ` – useimmiten ${DAYPART_LABEL[dayparts[0].value] || 'vaihtelevasti'}`
    : '';

  return {
    count: own.length,
    species,
    dayparts,
    text: `${speciesText}${whenText}.`,
    biggest: best.lengthCm ? best : null,
    entries: own,
  };
}

/** Totals for the journal view. */
export function overallStats(entries = listCatches()) {
  if (!entries.length) return null;
  const species = tally(entries, (entry) => entry.speciesName);
  const dayparts = tally(entries, (entry) => entry.conditions?.daypart);
  const places = tally(entries, (entry) => entry.place?.name);
  const withLength = entries.filter((entry) => Number.isFinite(entry.lengthCm));
  const biggest = withLength.length
    ? withLength.reduce((a, b) => (b.lengthCm > a.lengthCm ? b : a))
    : null;

  return {
    count: entries.length,
    species,
    dayparts,
    places,
    biggest,
    bestDaypartLabel: dayparts.length ? DAYPART_LABEL[dayparts[0].value] : null,
  };
}
