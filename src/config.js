/** Shared constants. All data sources are free and need no API key. */

export const DEFAULT_LOCATION = {
  lat: 61.4978,
  lon: 23.761,
  name: 'Tampere',
  meta: 'Oletussijainti – salli paikannus tai hae paikkakunta',
};

/** Overpass mirrors, tried in order until one answers. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-tekijät · sää: ' +
  '<a href="https://open-meteo.com/">Open-Meteo</a>';

export const SPOTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
export const FORECAST_DAYS = 3;
export const MAX_SPOTS = 120;
