import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPOT_CATEGORIES, categoryFor, categoryById, countByCategory } from '../src/spot-types.js';
import { parseOverpass } from '../src/spots.js';
import { makeOverpassPayload } from './fixtures.mjs';

const ORIGIN = { lat: 61.4978, lon: 23.761 };
const spot = (over = {}) => ({ waterType: 'tuntematon', isFishingSpot: false, facilities: [], ...over });

test('every category is complete and uniquely identified', () => {
  const ids = SPOT_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(ids).size, ids.length, 'category ids must be unique');
  for (const category of SPOT_CATEGORIES) {
    assert.ok(category.label && category.short && category.icon, `${category.id} is missing a label or icon`);
    assert.ok(category.short.length <= 12, `${category.short} is too long for a chip`);
  }
  const icons = SPOT_CATEGORIES.map((category) => category.icon);
  assert.equal(new Set(icons).size, icons.length,
    'icons must differ: they are what tells two categories sharing a hue apart');
});

test('categories are mutually exclusive and ordered by what matters', () => {
  // A marked fishing spot stays marked even when it sits on a lake.
  assert.equal(categoryFor(spot({ isFishingSpot: true, waterType: 'jarvi' })).id, 'merkitty');
  assert.equal(categoryFor(spot({ facilities: ['Laituri'], waterType: 'meri' })).id, 'merkitty');
  assert.equal(categoryFor(spot({ facilities: ['Veneluiska'] })).id, 'merkitty');

  assert.equal(categoryFor(spot({ waterType: 'jarvi' })).id, 'jarvi');
  assert.equal(categoryFor(spot({ waterType: 'lampi' })).id, 'jarvi');
  assert.equal(categoryFor(spot({ waterType: 'tekojarvi' })).id, 'jarvi');
  assert.equal(categoryFor(spot({ waterType: 'joki' })).id, 'joki');
  assert.equal(categoryFor(spot({ waterType: 'puro' })).id, 'joki');
  assert.equal(categoryFor(spot({ waterType: 'kanava' })).id, 'joki');
  assert.equal(categoryFor(spot({ waterType: 'meri' })).id, 'meri');
  assert.equal(categoryFor(spot({ waterType: 'tuntematon' })).id, 'muu');
  assert.equal(categoryFor(spot({ waterType: 'kalapaikka' })).id, 'muu');
});

test('every water type lands in exactly one category', async () => {
  const { WATER_TYPES } = await import('../src/species.js');
  for (const waterType of Object.keys(WATER_TYPES)) {
    const matches = SPOT_CATEGORIES.filter((category) => category.waterTypes?.includes(waterType));
    assert.ok(matches.length <= 1, `${waterType} belongs to ${matches.length} categories`);
    assert.ok(categoryFor(spot({ waterType })), `${waterType} has no category`);
  }
});

test('unknown input falls back instead of throwing', () => {
  assert.equal(categoryFor(null).id, 'muu');
  assert.equal(categoryFor(spot({ waterType: 'ei-tällaista' })).id, 'muu');
  assert.equal(categoryById('ei-tällaista').id, 'muu');
});

test('counts cover every category and add up to the spots given', () => {
  const spots = parseOverpass(makeOverpassPayload(ORIGIN), ORIGIN, 10);
  const counts = countByCategory(spots);

  assert.deepEqual(Object.keys(counts).sort(), SPOT_CATEGORIES.map((c) => c.id).sort());
  assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), spots.length);
  assert.equal(counts.merkitty, 2, 'the pier and the slipway are marked spots');
  assert.equal(counts.joki, 1);
  assert.ok(counts.jarvi >= 2);
});
