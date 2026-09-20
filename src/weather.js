/** Open-Meteo forecast fetching, normalised into hour and day records. */

import { OPEN_METEO_URL, FORECAST_DAYS, WEATHER_CACHE_TTL_MS } from './config.js';
import { cache, fetchWithTimeout, parseApiTime, CACHE_VERSION } from './util.js';

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'pressure_msl',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'is_day',
];

const DAILY_FIELDS = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset'];

import { weatherIconName } from './icons.js';

/** WMO weather codes in Finnish. */
const WEATHER_CODES = {
  0: 'Selkeää',
  1: 'Enimmäkseen selkeää',
  2: 'Puolipilvistä',
  3: 'Pilvistä',
  45: 'Sumua',
  48: 'Huurresumua',
  51: 'Tihkusadetta',
  53: 'Tihkusadetta',
  55: 'Voimakasta tihkua',
  56: 'Jäätävää tihkua',
  57: 'Jäätävää tihkua',
  61: 'Heikkoa sadetta',
  63: 'Sadetta',
  65: 'Voimakasta sadetta',
  66: 'Jäätävää sadetta',
  67: 'Jäätävää sadetta',
  71: 'Heikkoa lumisadetta',
  73: 'Lumisadetta',
  75: 'Voimakasta lumisadetta',
  77: 'Lumijyväsiä',
  80: 'Sadekuuroja',
  81: 'Sadekuuroja',
  82: 'Rajuja sadekuuroja',
  85: 'Lumikuuroja',
  86: 'Lumikuuroja',
  95: 'Ukkosta',
  96: 'Ukkosta ja rakeita',
  99: 'Rajua ukkosta',
};

export const describeWeatherCode = (code) => ({
  text: WEATHER_CODES[code] || 'Vaihtelevaa',
  icon: weatherIconName(code),
});

/**
 * Fetch and normalise the forecast for a coordinate.
 * The raw payload is cached per ~1 km grid cell for 30 minutes and normalised
 * on every read: the normalised form holds a Map and a "now" timestamp, and
 * neither survives a round trip through JSON.
 */
export async function fetchWeather(lat, lon) {
  const key = `kalaonni:weather:${CACHE_VERSION}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const cached = cache.get(key, WEATHER_CACHE_TTL_MS);
  if (cached) {
    try {
      return normaliseWeather(cached);
    } catch {
      /* unreadable entry – fall through and fetch a fresh forecast */
    }
  }

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY_FIELDS.join(','),
    daily: DAILY_FIELDS.join(','),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover,precipitation,is_day',
    timezone: 'auto',
    wind_speed_unit: 'ms',
    forecast_days: String(FORECAST_DAYS),
  });

  const response = await fetchWithTimeout(`${OPEN_METEO_URL}?${params}`, {}, 20000);
  if (!response.ok) throw new Error(`Sääpalvelu vastasi virheellä ${response.status}`);
  const raw = await response.json();

  cache.set(key, raw);
  return normaliseWeather(raw);
}

/** Turn the column-oriented Open-Meteo payload into per-hour and per-day records. */
export function normaliseWeather(raw) {
  const offset = raw.utc_offset_seconds ?? 0;
  const h = raw.hourly;

  const hours = h.time.map((iso, i) => ({
    time: parseApiTime(iso, offset),
    temp: h.temperature_2m[i],
    feelsLike: h.apparent_temperature[i],
    precip: h.precipitation[i] ?? 0,
    precipProbability: h.precipitation_probability?.[i] ?? null,
    code: h.weather_code[i],
    pressure: h.pressure_msl[i],
    cloud: h.cloud_cover[i],
    wind: h.wind_speed_10m[i],
    gust: h.wind_gusts_10m[i],
    windDir: h.wind_direction_10m[i],
    isDay: h.is_day[i] === 1,
  }));

  // Above the Arctic Circle the sun does not always rise or set; the API then
  // leaves the time out, and everything downstream has to cope with null.
  const sunTime = (iso) => (iso ? parseApiTime(iso, offset) : null);

  const days = raw.daily.time.map((iso, i) => ({
    dateKey: iso,
    sunrise: sunTime(raw.daily.sunrise?.[i]),
    sunset: sunTime(raw.daily.sunset?.[i]),
    tempMax: raw.daily.temperature_2m_max[i],
    tempMin: raw.daily.temperature_2m_min[i],
    code: raw.daily.weather_code[i],
  }));

  const sunByDate = new Map(days.map((d) => [d.dateKey, d]));

  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    utcOffsetSeconds: offset,
    /** Wall-clock "now" at the forecast location. */
    nowIso: currentIsoAtOffset(offset),
    current: raw.current
      ? {
          temp: raw.current.temperature_2m,
          code: raw.current.weather_code,
          wind: raw.current.wind_speed_10m,
          windDir: raw.current.wind_direction_10m,
          pressure: raw.current.pressure_msl,
          cloud: raw.current.cloud_cover,
          precip: raw.current.precipitation,
          isDay: raw.current.is_day === 1,
        }
      : null,
    hours,
    days,
    sunByDate,
  };
}

/** Current time as the forecast location's wall clock, truncated to the hour. */
function currentIsoAtOffset(offsetSeconds) {
  const shifted = new Date(Date.now() + offsetSeconds * 1000);
  return shifted.toISOString().slice(0, 13);
}
