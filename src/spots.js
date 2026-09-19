/** Nearby fishing spots and water bodies from OpenStreetMap via Overpass. */

import {
  OVERPASS_ENDPOINTS,
  SPOTS_CACHE_TTL_MS,
  MAX_SPOTS,
  OVERPASS_SPOT_TIMEOUT_MS,
  OVERPASS_WATER_TIMEOUT_MS,
  OVERPASS_TOTAL_BUDGET_MS,
} from './config.js';
import { cache, distanceKm, fetchWithTimeout, CACHE_VERSION } from './util.js';
import { WATER_TYPES } from './species.js';

const around = (lat, lon, radiusMeters) =>
  `(around:${radiusMeters},${lat.toFixed(5)},${lon.toFixed(5)})`;

/**
 * The half an angler cares about most: marked fishing spots, piers and
 * slipways. Few objects, so it usually answers in a second or two.
 */
function buildSpotQuery(lat, lon, radiusMeters) {
  const a = around(lat, lon, radiusMeters);
  return `[out:json][timeout:15];
(
  nwr["leisure"="fishing"]${a};
  nwr["fishing"~"^(yes|permitted|designated)$"]${a};
  nwr["man_made"="pier"]${a};
  nwr["leisure"="slipway"]${a};
);
out tags center 200;`;
}

/**
 * The heavy half: every named lake, pond, river and canal in the radius. In a
 * country this full of lakes that is thousands of objects, so it is its own
 * request and must never hold up the first results. A node is never a water
 * body, so the search covers ways and relations only.
 */
function buildWaterQuery(lat, lon, radiusMeters, limit) {
  const a = around(lat, lon, radiusMeters);
  return `[out:json][timeout:25];
(
  wr["natural"="water"]["name"]${a};
  wr["landuse"="reservoir"]["name"]${a};
  way["waterway"~"^(river|canal)$"]["name"]${a};
);
out tags center ${limit};`;
}

/**
 * Finnish water names are descriptive, so the suffix is a reliable hint when
 * OSM has no `water=*` tag. Checked only as a fallback.
 */
function waterTypeFromName(name = '') {
  const lower = name.toLowerCase();
  if (/(järvi|vesi|selkä|selka)$/.test(lower)) return 'jarvi';
  if (/(lampi|lammit)$/.test(lower)) return 'lampi';
  if (/(joki|koski|virta|väylä|vayla)$/.test(lower)) return 'joki';
  if (/(puro|oja)$/.test(lower)) return 'puro';
  if (/(meri|ulappa)$/.test(lower)) return 'meri';
  if (/(kanava)$/.test(lower)) return 'kanava';
  if (/(tekojärvi|allas)$/.test(lower)) return 'tekojarvi';
  return null;
}

export function classifyWater(tags = {}) {
  const name = tags.name || '';
  if (tags.salt === 'yes' || tags.water === 'sea' || tags.place === 'sea') return 'meri';

  const byWaterTag = {
    lake: 'jarvi',
    pond: 'lampi',
    basin: 'lampi',
    reservoir: 'tekojarvi',
    river: 'joki',
    stream: 'puro',
    canal: 'kanava',
    ditch: 'puro',
    lagoon: 'meri',
    oxbow: 'lampi',
  }[tags.water];
  if (byWaterTag) return byWaterTag;

  const byWaterway = { river: 'joki', canal: 'kanava', stream: 'puro' }[tags.waterway];
  if (byWaterway) return byWaterway;

  if (tags.landuse === 'reservoir') return 'tekojarvi';

  const byName = waterTypeFromName(name);
  if (byName) return byName;

  if (tags.natural === 'water') return 'jarvi';
  if (tags.leisure === 'fishing' || tags.fishing) return 'kalapaikka';
  return 'tuntematon';
}

function labelFor(tags, waterType) {
  if (tags.name) return tags.name;
  if (tags.leisure === 'fishing') return 'Kalastuspaikka';
  if (tags.man_made === 'pier') return 'Laituri';
  if (tags.leisure === 'slipway') return 'Veneluiska';
  return `Nimetön ${(WATER_TYPES[waterType]?.label || 'vesialue').toLowerCase()}`;
}

/** Extra facts worth showing on the card. */
function facilitiesFrom(tags) {
  const facilities = [];
  if (tags.leisure === 'fishing' || tags.fishing) facilities.push('Merkitty kalastuspaikka');
  if (tags.man_made === 'pier') facilities.push('Laituri');
  if (tags.leisure === 'slipway') facilities.push('Veneluiska');
  if (tags.wheelchair === 'yes') facilities.push('Esteetön');
  if (tags.fee === 'yes') facilities.push('Maksullinen');
  if (tags.fee === 'no') facilities.push('Maksuton');
  if (tags.fishing === 'no') facilities.push('Kalastus kielletty');
  return facilities;
}

function elementToSpot(element, origin) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const tags = element.tags || {};
  const waterType = classifyWater(tags);
  const isFishingSpot = tags.leisure === 'fishing' || ['yes', 'permitted', 'designated'].includes(tags.fishing);

  return {
    id: `${element.type}/${element.id}`,
    name: labelFor(tags, waterType),
    lat,
    lon,
    waterType,
    isFishingSpot,
    facilities: facilitiesFrom(tags),
    tags,
    distanceKm: distanceKm(origin, { lat, lon }),
  };
}

/** Drop repeats of the same named water within ~400 m of each other. */
function dedupe(spots) {
  const seen = new Map();
  for (const spot of spots) {
    const key = `${spot.name}|${spot.lat.toFixed(2)}|${spot.lon.toFixed(2)}`;
    const existing = seen.get(key);
    if (!existing || spot.distanceKm < existing.distanceKm || (!existing.isFishingSpot && spot.isFishingSpot)) {
      seen.set(key, spot);
    }
  }
  return Array.from(seen.values());
}

/**
 * A marked fishing spot rarely carries water tags of its own, which would
 * leave the species list vague. Inherit the type of the nearest classified
 * water instead. Overpass reports a large lake by its bounding-box centre,
 * which can sit far from the shore, so the radius is deliberately generous.
 */
const INHERIT_RADIUS_KM = 3;
function inheritWaterTypes(spots) {
  const classified = spots.filter((s) => !['tuntematon', 'kalapaikka'].includes(s.waterType));
  for (const spot of spots) {
    if (!['tuntematon', 'kalapaikka'].includes(spot.waterType)) continue;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const water of classified) {
      const d = distanceKm(spot, water);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = water;
      }
    }
    if (nearest && nearestDistance <= INHERIT_RADIUS_KM) {
      spot.waterType = nearest.waterType;
      spot.waterTypeSource = nearest.name;
    }
  }
  return spots;
}

/** Turn a raw Overpass answer into sorted spots. Exported for testing. */
export function parseOverpass(data, origin, radiusKm) {
  const spots = (data.elements || [])
    .map((element) => elementToSpot(element, origin))
    .filter((spot) => spot && spot.distanceKm <= radiusKm * 1.05 && spot.tags.fishing !== 'no');

  return inheritWaterTypes(dedupe(spots))
    .sort((a, b) => {
      // Marked fishing spots first, then by distance.
      if (a.isFishingSpot !== b.isFishingSpot) return a.isFishingSpot ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    })
    .slice(0, MAX_SPOTS);
}

/** Wrap an Overpass failure in something a person can act on. */
function describeFailure(error) {
  const message = String(error?.message || error || '');
  if (error?.name === 'AbortError' || /abort/i.test(message)) {
    return 'haku kesti liian kauan';
  }
  if (/^Overpass 429/.test(message)) return 'palvelu rajoitti pyyntöjä';
  if (/^Overpass 5\d\d/.test(message)) return 'palvelu on ruuhkainen';
  if (/^Overpass /.test(message)) return message.toLowerCase();
  return 'yhteysvirhe';
}

/**
 * Post one query, trying the mirrors in turn until the budget runs out.
 * Overpass is free and shared, so the mirrors are tried one at a time.
 */
async function runQuery(query, { timeoutMs, deadline }) {
  let lastError = new Error('ei yhteyttä');
  // Start from a different mirror each time: it spreads the load across the
  // volunteer-run servers and keeps one busy mirror from always being first.
  const offset = Math.floor(Math.random() * OVERPASS_ENDPOINTS.length);

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
    const endpoint = OVERPASS_ENDPOINTS[(offset + i) % OVERPASS_ENDPOINTS.length];
    const remaining = deadline - Date.now();
    if (remaining < 3000) break;                    // no time left for a real attempt
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      }, Math.min(timeoutMs, remaining));
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** One half of the search: cache, then network, then whatever the cache still holds. */
async function loadHalf({ name, key, query, timeoutMs, deadline, ttlMs }) {
  const fresh = cache.get(key, ttlMs);
  if (fresh) return { name, elements: fresh.elements || [], source: 'cache' };

  try {
    const data = await runQuery(query, { timeoutMs, deadline });
    cache.set(key, data);
    return { name, elements: data.elements || [], source: 'network' };
  } catch (error) {
    const stale = cache.getStale(key);
    if (stale?.value?.elements) {
      return { name, elements: stale.value.elements, source: 'stale', ageMs: stale.ageMs };
    }
    return { name, elements: [], source: 'failed', reason: describeFailure(error) };
  }
}

/**
 * Fetch spots around a coordinate.
 *
 * The two halves run in parallel and are cached separately. `onPartial` fires
 * as soon as the fast half lands, so marked fishing spots appear while the
 * water search is still running. A half that fails does not sink the other –
 * the result says what is missing instead.
 *
 * @returns {Promise<{spots: Array, partial: boolean, stale: boolean, staleAgeMs: number|null, failures: string[]}>}
 */
export async function fetchSpots(lat, lon, radiusKm, { onPartial } = {}) {
  const origin = { lat, lon };
  const radiusMeters = Math.round(radiusKm * 1000);
  const deadline = Date.now() + OVERPASS_TOTAL_BUDGET_MS;
  const baseKey = `kalaonni:spots:${CACHE_VERSION}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusKm}`;
  // A wide radius in a lake-rich area returns far more than anyone can use.
  const waterLimit = radiusKm >= 25 ? MAX_SPOTS : MAX_SPOTS * 2;

  const spotHalf = loadHalf({
    name: 'kalastuspaikat',
    key: `${baseKey}:spots`,
    query: buildSpotQuery(lat, lon, radiusMeters),
    timeoutMs: OVERPASS_SPOT_TIMEOUT_MS,
    ttlMs: SPOTS_CACHE_TTL_MS,
    deadline,
  });

  const waterHalf = loadHalf({
    name: 'vesistöt',
    key: `${baseKey}:water`,
    query: buildWaterQuery(lat, lon, radiusMeters, waterLimit),
    timeoutMs: OVERPASS_WATER_TIMEOUT_MS,
    ttlMs: SPOTS_CACHE_TTL_MS,
    deadline,
  });

  // Show the marked fishing spots the moment they arrive.
  if (onPartial) {
    spotHalf.then((half) => {
      if (half.elements.length) {
        onPartial(parseOverpass({ elements: half.elements }, origin, radiusKm));
      }
    }).catch(() => { /* reported through the final result */ });
  }

  const [spotResult, waterResult] = await Promise.all([spotHalf, waterHalf]);
  const halves = [spotResult, waterResult];

  const failures = halves.filter((half) => half.source === 'failed');
  if (failures.length === halves.length) {
    throw new Error(
      `Kalapaikkojen haku ei onnistunut (${failures[0].reason}). ` +
      'OpenStreetMapin Overpass-palvelu on ilmainen ja ajoittain ruuhkainen. ' +
      'Yritä uudelleen tai pienennä hakusädettä.',
    );
  }

  const staleHalves = halves.filter((half) => half.source === 'stale');
  return {
    spots: parseOverpass({ elements: halves.flatMap((half) => half.elements) }, origin, radiusKm),
    partial: failures.length > 0,
    stale: staleHalves.length > 0,
    staleAgeMs: staleHalves.length ? Math.max(...staleHalves.map((half) => half.ageMs)) : null,
    failures: failures.map((half) => ({ name: half.name, reason: half.reason })),
  };
}
