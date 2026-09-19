/**
 * Deterministic stand-ins for the live APIs.
 * Used by the unit tests and by the browser smoke test, which serves these
 * payloads instead of calling Open-Meteo and Overpass.
 */

const HOURS = 72;

/** Open-Meteo style forecast around a September low-pressure passage. */
export function makeWeatherPayload({ lat = 61.4978, lon = 23.761, startDate = '2026-09-19' } = {}) {
  const time = [];
  const temperature_2m = [];
  const apparent_temperature = [];
  const precipitation = [];
  const precipitation_probability = [];
  const weather_code = [];
  const pressure_msl = [];
  const cloud_cover = [];
  const wind_speed_10m = [];
  const wind_gusts_10m = [];
  const wind_direction_10m = [];
  const is_day = [];

  const [y, m, d] = startDate.split('-').map(Number);
  for (let i = 0; i < HOURS; i += 1) {
    const date = new Date(Date.UTC(y, m - 1, d, i));
    const iso = `${date.toISOString().slice(0, 13)}:00`;
    const hourOfDay = date.getUTCHours();

    const daily = Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI);
    const temp = 11 + 5 * daily - i * 0.02;
    // Pressure falls through day two and recovers on day three.
    const pressure = 1016 - 9 * Math.sin((Math.min(i, 48) / 48) * Math.PI);
    const cloud = Math.round(40 + 45 * Math.sin((i / 17) * Math.PI) ** 2);
    const wind = 2.2 + 3.4 * Math.sin((i / 23) * Math.PI) ** 2;
    const rain = i > 30 && i < 36 ? 0.6 : i > 50 && i < 53 ? 3.4 : 0;

    time.push(iso);
    temperature_2m.push(Number(temp.toFixed(1)));
    apparent_temperature.push(Number((temp - 1.8).toFixed(1)));
    precipitation.push(rain);
    precipitation_probability.push(rain > 0 ? 80 : cloud > 70 ? 30 : 5);
    weather_code.push(rain > 2 ? 63 : rain > 0 ? 61 : cloud > 70 ? 3 : cloud > 35 ? 2 : 0);
    pressure_msl.push(Number(pressure.toFixed(1)));
    cloud_cover.push(cloud);
    wind_speed_10m.push(Number(wind.toFixed(1)));
    wind_gusts_10m.push(Number((wind * 1.9).toFixed(1)));
    wind_direction_10m.push((200 + i * 3) % 360);
    is_day.push(hourOfDay >= 7 && hourOfDay < 20 ? 1 : 0);
  }

  const days = [0, 1, 2].map((offset) => {
    const date = new Date(Date.UTC(y, m - 1, d + offset));
    return date.toISOString().slice(0, 10);
  });

  return {
    latitude: lat,
    longitude: lon,
    timezone: 'Europe/Helsinki',
    utc_offset_seconds: 10800,
    current: {
      temperature_2m: temperature_2m[8],
      weather_code: weather_code[8],
      wind_speed_10m: wind_speed_10m[8],
      wind_direction_10m: wind_direction_10m[8],
      pressure_msl: pressure_msl[8],
      cloud_cover: cloud_cover[8],
      precipitation: precipitation[8],
      is_day: 1,
    },
    hourly: {
      time,
      temperature_2m,
      apparent_temperature,
      precipitation,
      precipitation_probability,
      weather_code,
      pressure_msl,
      cloud_cover,
      wind_speed_10m,
      wind_direction_10m,
      wind_gusts_10m,
      is_day,
    },
    daily: {
      time: days,
      weather_code: [3, 61, 2],
      temperature_2m_max: [16.1, 14.4, 13.2],
      temperature_2m_min: [7.2, 8.1, 6.4],
      sunrise: days.map((day) => `${day}T06:55`),
      sunset: days.map((day) => `${day}T19:52`),
    },
  };
}

/** Overpass style answer with a lake, a river, a pond and a marked fishing spot. */
export function makeOverpassPayload({ lat = 61.4978, lon = 23.761 } = {}) {
  return {
    elements: [
      {
        type: 'way', id: 101, center: { lat: lat + 0.02, lon: lon + 0.015 },
        tags: { name: 'Näsijärvi', natural: 'water', water: 'lake' },
      },
      {
        type: 'way', id: 102, center: { lat: lat - 0.03, lon: lon + 0.04 },
        tags: { name: 'Tammerkoski', waterway: 'river' },
      },
      {
        type: 'node', id: 103, lat: lat + 0.008, lon: lon - 0.02,
        tags: { name: 'Kaupin kalastuslaituri', leisure: 'fishing', fishing: 'yes', wheelchair: 'yes' },
      },
      {
        type: 'way', id: 104, center: { lat: lat - 0.05, lon: lon - 0.05 },
        tags: { name: 'Iidesjärvi', natural: 'water', water: 'pond' },
      },
      {
        type: 'node', id: 105, lat: lat + 0.001, lon: lon + 0.001,
        tags: { leisure: 'slipway', name: 'Veneluiska' },
      },
    ],
  };
}

/** Nominatim style search answer. */
export function makeGeocodePayload() {
  return [
    { lat: '61.4977', lon: '23.7610', display_name: 'Tampere, Pirkanmaa, Suomi', type: 'city', name: 'Tampere' },
    { lat: '61.5500', lon: '23.8000', display_name: 'Näsijärvi, Tampere, Suomi', type: 'water', name: 'Näsijärvi' },
  ];
}

if (process.argv[2] === '--dump') {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const dir = new URL('./stubs/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('weather.json', dir), JSON.stringify(makeWeatherPayload(), null, 1));
  writeFileSync(new URL('overpass.json', dir), JSON.stringify(makeOverpassPayload(), null, 1));
  writeFileSync(new URL('geocode.json', dir), JSON.stringify(makeGeocodePayload(), null, 1));
  console.log('stubs written');
}
