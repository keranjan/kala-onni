/** Browser geolocation and Nominatim search / reverse geocoding. */

import { NOMINATIM_URL } from './config.js';
import { fetchWithTimeout } from './util.js';

/** Ask the browser where we are. Rejects with a Finnish, user-facing message. */
export function locateMe({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Selaimesi ei tue paikannusta.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      (error) => {
        const messages = {
          1: 'Paikannus estetty. Salli sijainnin käyttö selaimen asetuksista tai hae paikkakunta hakukentällä.',
          2: 'Sijaintia ei saatu selville. Kokeile uudelleen tai hae paikkakunta hakukentällä.',
          3: 'Paikannus kesti liian kauan. Kokeile uudelleen.',
        };
        reject(new Error(messages[error.code] || 'Paikannus epäonnistui.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 120000 },
    );
  });
}

/**
 * Follow the device position until the returned function is called.
 * Used while browsing the map, so the dot, the distances and – when the user
 * asks for it – the map view keep up as they move.
 */
export function watchLocation({ onPosition, onError } = {}) {
  if (!('geolocation' in navigator)) {
    onError?.(new Error('Selaimesi ei tue paikannusta.'));
    return () => {};
  }

  const id = navigator.geolocation.watchPosition(
    (position) => onPosition?.({
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
      at: position.timestamp,
    }),
    (error) => {
      // A watch reports POSITION_UNAVAILABLE and TIMEOUT whenever the fix
      // drops – indoors, in a tunnel, while the GPS warms up – and then
      // recovers on its own. Only a denied permission ends the tracking.
      const messages = {
        1: 'Paikannus estetty. Salli sijainnin käyttö selaimen asetuksista.',
        2: 'Sijaintia ei juuri nyt saada selville.',
        3: 'Sijainnin haku kesti liian kauan.',
      };
      const reported = new Error(messages[error.code] || 'Paikannus epäonnistui.');
      reported.code = error.code;
      reported.fatal = error.code === 1;
      onError?.(reported);
    },
    // A fresh fix matters more than battery here, but a few seconds old is fine.
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );

  return () => navigator.geolocation.clearWatch(id);
}

/** Free-text place search, biased towards Finland. */
export async function searchPlaces(query, { limit = 6 } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(limit),
    addressdetails: '1',
    'accept-language': 'fi',
  });
  const response = await fetchWithTimeout(`${NOMINATIM_URL}/search?${params}`, {
    headers: { Accept: 'application/json' },
  }, 15000);
  if (!response.ok) throw new Error('Paikkahaku ei juuri nyt vastaa.');
  const results = await response.json();

  return results.map((hit) => ({
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    name: hit.name || hit.display_name.split(',')[0],
    description: hit.display_name,
    kind: hit.type,
  }));
}

/** Turn a coordinate into a readable place name; never throws. */
export async function describeLocation(lat, lon) {
  const params = new URLSearchParams({
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    format: 'jsonv2',
    zoom: '12',
    'accept-language': 'fi',
  });
  try {
    const response = await fetchWithTimeout(`${NOMINATIM_URL}/reverse?${params}`, {
      headers: { Accept: 'application/json' },
    }, 12000);
    if (!response.ok) return null;
    const data = await response.json();
    const address = data.address || {};
    const place = address.village || address.town || address.city || address.municipality || address.county;
    return place || data.name || null;
  } catch {
    return null;
  }
}
