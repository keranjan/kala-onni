/** Nearby fishing spots and water bodies from OpenStreetMap via Overpass. */

import { OVERPASS_ENDPOINTS, SPOTS_CACHE_TTL_MS, MAX_SPOTS } from './config.js';
import { cache, distanceKm, fetchWithTimeout } from './util.js';
import { WATER_TYPES } from './species.js';

/**
 * Overpass QL for everything an angler cares about within `radius` metres:
 * marked fishing spots, named waters, rivers, piers and slipways.
 */
function buildQuery(lat, lon, radiusMeters) {
  const around = `(around:${radiusMeters},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:40];
(
  nwr["leisure"="fishing"]${around};
  nwr["fishing"~"^(yes|permitted|designated)$"]${around};
  nwr["natural"="water"]["name"]${around};
  nwr["landuse"="reservoir"]["name"]${around};
  way["waterway"~"^(river|canal)$"]["name"]${around};
  nwr["man_made"="pier"]${around};
  nwr["leisure"="slipway"]${around};
);
out tags center ${MAX_SPOTS * 3};`;
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

/**
 * Fetch spots around a coordinate. Tries the Overpass mirrors in turn and
 * caches the answer, because Overpass is a shared free service.
 */
export async function fetchSpots(lat, lon, radiusKm) {
  const origin = { lat, lon };
  const key = `kalaonni:spots:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusKm}`;
  const cached = cache.get(key, SPOTS_CACHE_TTL_MS);
  if (cached) return parseOverpass(cached, origin, radiusKm);

  const query = buildQuery(lat, lon, Math.round(radiusKm * 1000));
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      }, 45000);
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      const data = await response.json();
      cache.set(key, data);
      return parseOverpass(data, origin, radiusKm);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Kalapaikkojen haku ei onnistunut (${lastError?.message || 'ei yhteyttä'}). ` +
    'OpenStreetMapin Overpass-palvelu voi olla ruuhkainen – yritä hetken kuluttua uudelleen.',
  );
}
