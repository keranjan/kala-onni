import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseWeather } from '../src/weather.js';
import { scoreHours, bestWindows, moonPhase, daypart, verdictFor } from '../src/score.js';
import { matchSpecies, getSpecies, GENERIC_PROFILE } from '../src/species.js';
import { makeWeatherPayload } from './fixtures.mjs';

// Pinned to a fixed day: these assertions are about specific clock times.
const weather = normaliseWeather(makeWeatherPayload({ startDate: '2026-09-19' }));

test('forecast normalises into hours and days', () => {
  assert.equal(weather.hours.length, 72);
  assert.equal(weather.days.length, 3);
  assert.equal(weather.hours[0].time.clock, '00.00'); // wall clock at the spot
  // Wall clock 00.00 in UTC+3 is 21:00 UTC the previous day.
  assert.equal(new Date(weather.hours[0].time.instant).toISOString(), '2026-09-18T21:00:00.000Z');
  assert.ok(weather.sunByDate.get(weather.days[0].dateKey).sunrise.hour === 6);
});

test('every hour gets a score inside 0–100 with explaining factors', () => {
  const scored = scoreHours(weather);
  assert.equal(scored.length, 72);
  for (const entry of scored) {
    assert.ok(entry.score >= 0 && entry.score <= 100, `score out of range: ${entry.score}`);
    assert.ok(entry.factors.length >= 3);
    assert.ok(entry.verdict.label.length > 0);
  }
});

test('dawn and dusk beat the middle of the night for a generic profile', () => {
  const scored = scoreHours(weather);
  const byPart = (part) => scored.filter((e) => e.daypart === part);
  const mean = (list) => list.reduce((sum, e) => sum + e.score, 0) / list.length;

  assert.ok(byPart('aamu').length > 0 && byPart('yo').length > 0);
  assert.ok(mean(byPart('aamu')) > mean(byPart('yo')));
  assert.ok(mean(byPart('ilta')) > mean(byPart('paiva')));
});

test('burbot prefers the night, perch does not', () => {
  const made = scoreHours(weather, getSpecies('made'));
  const ahven = scoreHours(weather, getSpecies('ahven'));
  const nightMade = made.filter((e) => e.daypart === 'yo');
  const nightAhven = ahven.filter((e) => e.daypart === 'yo');
  const mean = (list) => list.reduce((sum, e) => sum + e.score, 0) / list.length;
  assert.ok(mean(nightMade) > mean(nightAhven));
});

test('best windows are ordered, at least two hours long and in the future', () => {
  const scored = scoreHours(weather);
  const windows = bestWindows(scored, { count: 3 });
  assert.ok(windows.length > 0 && windows.length <= 3);
  for (const w of windows) {
    assert.ok(w.hours >= 2);
    assert.ok(w.end.instant >= w.start.instant);
    assert.ok(w.reasons.length > 0);
  }
  assert.ok(windows[0].peakScore >= windows[windows.length - 1].peakScore);
});

test('daypart falls back to the API day flag during polar day', () => {
  const hour = weather.hours[12];
  const result = daypart(hour, { sunrise: {}, sunset: {} });
  assert.equal(result.part, hour.isDay ? 'paiva' : 'yo');
});

test('moon phase stays in range and flags new and full moon', () => {
  const phases = [];
  for (let i = 0; i < 30; i += 1) phases.push(moonPhase(Date.UTC(2026, 8, 1 + i)));
  assert.ok(phases.every((p) => p.phase >= 0 && p.phase < 1 && p.illumination >= 0 && p.illumination <= 1));
  assert.ok(phases.some((p) => p.bonus >= 4));
  assert.ok(phases.some((p) => p.bonus === 0));
});

test('verdict thresholds are monotonic', () => {
  const labels = [10, 40, 55, 70, 90].map((s) => verdictFor(s).label);
  assert.deepEqual(labels, ['Huono', 'Heikko', 'Kohtalainen', 'Hyvä', 'Erinomainen']);
});

test('species matching respects habitat, latitude and closed seasons', () => {
  const lake = matchSpecies({ waterType: 'jarvi', lat: 61.5, month: 7 });
  assert.equal(lake[0].id, 'ahven');
  assert.ok(!lake.some((s) => s.id === 'silakka'), 'sea species must not appear in a lake');

  const southernRiver = matchSpecies({ waterType: 'joki', lat: 60.2, month: 6 });
  assert.ok(!southernRiver.some((s) => s.id === 'nieria'), 'arctic char is a northern species');

  const autumnRiver = matchSpecies({ waterType: 'joki', lat: 62, month: 10 });
  const trout = autumnRiver.find((s) => s.id === 'taimen');
  assert.ok(trout.isClosed && trout.closedNote.includes('rauhoitettu'));

  const sea = matchSpecies({ waterType: 'meri', lat: 60.1, month: 8 });
  assert.ok(sea.some((s) => s.id === 'kampela'));
});

test('unknown water types stay inland', () => {
  const vague = matchSpecies({ waterType: 'tuntematon', lat: 63, month: 10 });
  assert.ok(vague.length > 0);
  assert.ok(!vague.some((s) => s.id === 'silakka' || s.id === 'kampela'));
});

test('generic profile is used when no species is given', () => {
  const a = scoreHours(weather);
  const b = scoreHours(weather, GENERIC_PROFILE);
  assert.deepEqual(a.map((e) => e.score), b.map((e) => e.score));
});

test('an unknown water type lowers every estimate the same way, and says so', () => {
  const lake = matchSpecies({ waterType: 'jarvi', lat: 61.5, month: 7 });
  const unknown = matchSpecies({ waterType: 'tuntematon', lat: 61.5, month: 7 });
  const marked = matchSpecies({ waterType: 'kalapaikka', lat: 61.5, month: 7 });

  const perchIn = (list) => list.find((s) => s.id === 'ahven').likelihood;
  assert.ok(perchIn(unknown) < perchIn(lake), 'an unknown water cannot be as certain as a known one');
  assert.equal(perchIn(marked), perchIn(unknown),
    'a marked fishing spot says nothing about the water, so it scores like any unknown');

  const known = lake.find((s) => s.id === 'ahven');
  const vague = unknown.find((s) => s.id === 'ahven');
  assert.equal(known.habitatKnown, true);
  assert.equal(vague.habitatKnown, false);
  assert.match(vague.reasons.find((r) => r.label === 'Vesityyppi').detail, /ei tiedossa/);
  assert.match(known.reasons.find((r) => r.label === 'Vesityyppi').detail, /järvi/);
});

test('every species explains its own estimate', () => {
  for (const fish of matchSpecies({ waterType: 'joki', lat: 62, month: 10 })) {
    assert.ok(fish.reasons.length >= 4, `${fish.name} has no breakdown`);
    for (const reason of fish.reasons) {
      assert.ok(reason.label && reason.detail, `${fish.name} has an empty reason`);
      assert.equal(typeof reason.good, 'boolean');
    }
    if (fish.isClosed) {
      assert.ok(fish.reasons.some((r) => r.label === 'Rauhoitus'), `${fish.name} hides its closed season`);
    }
  }
});
