/**
 * "Kalaonni" scoring: how promising a given hour looks for fishing.
 *
 * The score starts from a neutral 50 and each weather factor pushes it up or
 * down. Every adjustment is kept as a named factor so the UI can explain the
 * result instead of showing a bare number. Species preferences (see
 * species.js) re-weight light, wind, pressure, cloud and temperature.
 *
 * This is an angler's rule-of-thumb model, not a biological prediction.
 */

import { GENERIC_PROFILE } from './species.js';
import { clamp, windDirection } from './util.js';

/**
 * Keep the middle of the scale linear but compress the ends, so a stack of
 * favourable factors lands in the nineties instead of pinning everything at
 * 100 and hiding the difference between a good hour and a great one.
 */
function softKnee(raw) {
  const KNEE = 78;
  if (raw > KNEE) return KNEE + (raw - KNEE) * 0.45;
  if (raw < 100 - KNEE) return 100 - KNEE - (100 - KNEE - raw) * 0.45;
  return raw;
}

const SYNODIC_MONTH = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Moon phase 0 = new, 0.5 = full. */
export function moonPhase(dateMs = Date.now()) {
  const days = (dateMs - KNOWN_NEW_MOON) / 86400000;
  const phase = ((days / SYNODIC_MONTH) % 1 + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;

  let name = 'Kasvava sirppi';
  if (phase < 0.03 || phase > 0.97) name = 'Uusikuu';
  else if (phase < 0.22) name = 'Kasvava sirppi';
  else if (phase < 0.28) name = 'Ensimmäinen neljännes';
  else if (phase < 0.47) name = 'Kasvava kuu';
  else if (phase < 0.53) name = 'Täysikuu';
  else if (phase < 0.72) name = 'Vähenevä kuu';
  else if (phase < 0.78) name = 'Viimeinen neljännes';
  else name = 'Vähenevä sirppi';

  // Solunar rule of thumb: new and full moon are the strongest periods.
  const distanceToNewOrFull = Math.min(phase, Math.abs(phase - 0.5), 1 - phase);
  let bonus = 0;
  if (distanceToNewOrFull < 0.05) bonus = 7;
  else if (distanceToNewOrFull < 0.1) bonus = 4;
  else if (Math.abs(phase - 0.25) < 0.04 || Math.abs(phase - 0.75) < 0.04) bonus = 2;

  return { phase, illumination, name, bonus };
}

/** Which part of the day an hour falls in, relative to sunrise and sunset. */
export function daypart(hour, sunDay) {
  const sunrise = sunDay?.sunrise?.instant;
  const sunset = sunDay?.sunset?.instant;

  // Polar day / polar night, or a missing sun time: fall back to the API flag.
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset)) {
    return { part: hour.isDay ? 'paiva' : 'yo', minutesToSun: null, anchor: null };
  }

  const minutesFromSunrise = (hour.time.instant - sunrise) / 60000;
  const minutesFromSunset = (hour.time.instant - sunset) / 60000;
  const nearSunrise = Math.abs(minutesFromSunrise) <= Math.abs(minutesFromSunset);
  const minutesToSun = nearSunrise ? minutesFromSunrise : minutesFromSunset;

  if (Math.abs(minutesToSun) <= 80) {
    return { part: nearSunrise ? 'aamu' : 'ilta', minutesToSun, anchor: nearSunrise ? 'auringonnousu' : 'auringonlasku' };
  }
  const isDaytime = hour.time.instant > sunrise && hour.time.instant < sunset;
  return {
    part: isDaytime ? 'paiva' : 'yo',
    minutesToSun,
    anchor: nearSunrise ? 'auringonnousu' : 'auringonlasku',
  };
}

const DAYPART_LABEL = {
  aamu: 'Aamuhämärä',
  paiva: 'Päivä',
  ilta: 'Iltahämärä',
  yo: 'Yö',
};

function lightFactor(hour, sunDay, profile) {
  const { part, minutesToSun, anchor } = daypart(hour, sunDay);
  const weight = profile.lightPref[part] ?? 0.5;
  let delta = (weight - 0.55) * 40;

  // The sharpest peak sits right on the sun's edge.
  if ((part === 'aamu' || part === 'ilta') && minutesToSun !== null && Math.abs(minutesToSun) <= 40) {
    delta += 4;
  }

  let note;
  if (part === 'aamu' || part === 'ilta') {
    const direction = anchor === 'auringonnousu' ? 'auringonnoususta' : 'auringonlaskusta';
    note = `${DAYPART_LABEL[part]} – noin ${Math.round(Math.abs(minutesToSun ?? 0))} min ${direction}`;
  } else if (part === 'paiva') {
    note = weight >= 0.7 ? 'Päivänvalo sopii tälle lajille' : 'Keskellä päivää valo on kirkkaimmillaan';
  } else {
    note = weight >= 0.7 ? 'Yöaika sopii tälle lajille' : 'Yöaika – useimmat lajit ovat hitaita';
  }

  return { id: 'valo', label: 'Vuorokaudenaika', delta, note, part };
}

function windFactor(hour, profile) {
  const [idealMin, idealMax] = profile.windIdeal;
  const wind = hour.wind ?? 0;
  let delta;
  let note;

  if (wind < 0.7) {
    delta = -5;
    note = 'Peilityyni – kalat varovaisia, käytä hentoja siimoja';
  } else if (wind >= idealMin && wind <= idealMax) {
    delta = 11;
    note = 'Sopiva väreily pinnassa';
  } else if (wind < idealMin) {
    delta = 3;
    note = 'Lähes tyyntä';
  } else if (wind <= idealMax + 3) {
    delta = 1;
    note = 'Tuulista mutta kalastettavaa';
  } else if (wind <= 12) {
    delta = -9;
    note = 'Kova tuuli vaikeuttaa heittoa ja veneilyä';
  } else {
    delta = -18;
    note = 'Liian kova tuuli – vene kannattaa jättää rantaan';
  }

  if ((hour.gust ?? 0) >= 15 && delta > -18) {
    delta -= 6;
    note += `, puuskat ${Math.round(hour.gust)} m/s`;
  }

  return {
    id: 'tuuli',
    label: 'Tuuli',
    delta,
    note: `${note} (${hour.wind?.toFixed(1).replace('.', ',')} m/s ${windDirection(hour.windDir ?? 0)})`,
  };
}

function pressureFactor(hour, trend, profile) {
  const pref = profile.pressurePref;
  let delta;
  let note;

  if (trend === null) {
    return { id: 'paine', label: 'Ilmanpaine', delta: 0, note: 'Painetrendi ei tiedossa' };
  }

  if (Math.abs(trend) < 0.8) {
    delta = pref === 'vakaa' ? 9 : 3;
    note = 'Vakaa ilmanpaine – kalat ovat tottuneet olosuhteisiin';
  } else if (trend <= -0.8 && trend > -2.5) {
    delta = pref === 'lasku' ? 13 : 8;
    note = 'Paine laskee hitaasti – kalat syövät usein ennen säärintamaa';
  } else if (trend <= -2.5) {
    delta = pref === 'lasku' ? -2 : -8;
    note = 'Paine romahtaa – sää muuttuu nopeasti ja syönti tyrehtyy usein';
  } else if (trend < 2.5) {
    delta = -5;
    note = 'Paine nousee – syönti on usein nihkeää rintaman jälkeen';
  } else {
    delta = -10;
    note = 'Paine nousee jyrkästi – tyypillisesti heikkoa syöntiä';
  }

  const sign = trend > 0 ? '+' : '';
  return {
    id: 'paine',
    label: 'Ilmanpaine',
    delta,
    note: `${note} (${sign}${trend.toFixed(1).replace('.', ',')} hPa / 3 h, ${Math.round(hour.pressure)} hPa)`,
  };
}

function cloudFactor(hour, profile) {
  const cloud = hour.cloud ?? 50;
  const pref = profile.cloudPref;
  let delta = 0;

  if (pref === 'pilvinen') delta = cloud >= 60 ? 8 : cloud >= 30 ? 3 : -6;
  else if (pref === 'kirkas') delta = cloud <= 30 ? 7 : cloud <= 70 ? 2 : -4;
  else delta = cloud >= 25 && cloud <= 85 ? 6 : cloud < 25 ? -3 : 1;

  const note =
    cloud >= 85 ? 'Täysin pilvistä' : cloud >= 55 ? 'Pilvistä' : cloud >= 25 ? 'Puolipilvistä' : 'Kirkasta';
  return { id: 'pilvet', label: 'Pilvisyys', delta, note: `${note} (${Math.round(cloud)} %)` };
}

function precipitationFactor(hour) {
  const precip = hour.precip ?? 0;
  if (precip === 0) return { id: 'sade', label: 'Sade', delta: 1, note: 'Poutaa' };
  if (precip <= 1) return { id: 'sade', label: 'Sade', delta: 5, note: 'Kevyt sade sumentaa pintaa ja rohkaisee kaloja' };
  if (precip <= 3) return { id: 'sade', label: 'Sade', delta: -2, note: `Sadetta ${precip.toFixed(1).replace('.', ',')} mm/h` };
  return { id: 'sade', label: 'Sade', delta: -11, note: `Voimakasta sadetta ${precip.toFixed(1).replace('.', ',')} mm/h` };
}

function temperatureFactor(hour, profile) {
  const [min, max] = profile.tempIdeal;
  const temp = hour.temp;
  let delta;
  let note;

  if (temp >= min && temp <= max) {
    delta = 6;
    note = 'Lajille sopiva lämpötila';
  } else if (temp >= min - 5 && temp <= max + 5) {
    delta = 0;
    note = 'Lämpötila hieman ihanteen ulkopuolella';
  } else if (temp < -12 || temp > 28) {
    delta = -12;
    note = 'Ääriolosuhteet hidastavat kalojen liikettä';
  } else {
    delta = -7;
    note = temp < min ? 'Kylmää lajin ihanteeseen nähden' : 'Lämmintä lajin ihanteeseen nähden';
  }

  return { id: 'lampo', label: 'Lämpötila', delta, note: `${note} (${Math.round(temp)} °C)` };
}

export function verdictFor(score) {
  if (score >= 78) return { label: 'Erinomainen', tone: 'good' };
  if (score >= 64) return { label: 'Hyvä', tone: 'good' };
  if (score >= 50) return { label: 'Kohtalainen', tone: 'warning' };
  if (score >= 34) return { label: 'Heikko', tone: 'serious' };
  return { label: 'Huono', tone: 'critical' };
}

/**
 * Score every forecast hour.
 * @param {object} weather normalised forecast from weather.js
 * @param {object} [profile] species profile; defaults to the generic one
 */
export function scoreHours(weather, profile = GENERIC_PROFILE) {
  const moon = moonPhase(Date.now());

  return weather.hours.map((hour, index) => {
    const sunDay = weather.sunByDate.get(hour.time.dateKey);
    const previous = weather.hours[index - 3] ?? weather.hours[index - 1] ?? null;
    const trend = previous
      ? (hour.pressure - previous.pressure) * (index - 3 >= 0 ? 1 : 3)
      : null;

    const factors = [
      lightFactor(hour, sunDay, profile),
      windFactor(hour, profile),
      pressureFactor(hour, trend, profile),
      cloudFactor(hour, profile),
      precipitationFactor(hour),
      temperatureFactor(hour, profile),
    ];

    if (moon.bonus > 0) {
      factors.push({
        id: 'kuu',
        label: 'Kuun vaihe',
        delta: moon.bonus,
        note: `${moon.name} – solunar-teorian mukaan vilkasta aikaa`,
      });
    }

    const raw = 50 + factors.reduce((sum, factor) => sum + factor.delta, 0);
    const score = Math.round(clamp(softKnee(raw), 0, 100));

    return {
      hour,
      score,
      verdict: verdictFor(score),
      daypart: factors[0].part,
      factors: factors.filter((f) => Math.abs(f.delta) >= 0.5).sort((a, b) => b.delta - a.delta),
      moon,
    };
  });
}

/** Drop hours that are already in the past at the forecast location. */
export function upcomingHours(scored, nowIso) {
  const index = scored.findIndex((entry) => entry.hour.time.iso.slice(0, 13) >= nowIso);
  return index === -1 ? [] : scored.slice(index);
}

/**
 * Merge consecutive promising hours into windows and return the best ones.
 * A window needs at least two hours to be worth the trip, and a long stretch
 * of decent weather is trimmed to the best few hours around its peak so the
 * answer stays actionable ("06–09", not "04–01").
 */
export function bestWindows(scored, { count = 3, minHours = 2, maxHours = 5 } = {}) {
  if (!scored.length) return [];

  const peak = Math.max(...scored.map((entry) => entry.score));
  const threshold = Math.max(58, peak - 10);

  const runs = [];
  let current = null;
  for (const entry of scored) {
    if (entry.score >= threshold) {
      if (!current) current = [entry];
      else current.push(entry);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);

  const trimmed = runs
    .filter((run) => run.length >= minHours)
    .map((run) => {
      if (run.length <= maxHours) return run;
      // Slide a window of maxHours over the run and keep the strongest slice.
      let best = run.slice(0, maxHours);
      let bestSum = -Infinity;
      for (let i = 0; i + maxHours <= run.length; i += 1) {
        const slice = run.slice(i, i + maxHours);
        const sum = slice.reduce((total, entry) => total + entry.score, 0);
        if (sum > bestSum) {
          bestSum = sum;
          best = slice;
        }
      }
      return best;
    });

  return trimmed
    .map((entries) => {
      const best = entries.reduce((a, b) => (b.score > a.score ? b : a));
      const average = Math.round(entries.reduce((sum, e) => sum + e.score, 0) / entries.length);
      const reasons = best.factors.filter((f) => f.delta > 0).slice(0, 2).map((f) => f.note);
      return {
        start: entries[0].hour.time,
        end: entries[entries.length - 1].hour.time,
        hours: entries.length,
        peakScore: best.score,
        peakTime: best.hour.time,
        averageScore: average,
        verdict: verdictFor(best.score),
        reasons,
        entries,
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore || b.peakScore - a.peakScore || a.start.instant - b.start.instant)
    .slice(0, count);
}
