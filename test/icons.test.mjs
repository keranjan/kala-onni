import { test } from 'node:test';
import assert from 'node:assert/strict';

import { iconSvg, weatherIconName, ICON_NAMES } from '../src/icons.js';

test('every icon is well-formed SVG that follows the theme colour', () => {
  for (const name of ICON_NAMES) {
    const svg = iconSvg(name, { phase: 0.3 });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${name} is not an svg`);
    assert.ok(svg.includes('viewBox="0 0 24 24"'), `${name} has no viewBox`);
    assert.ok(svg.includes('currentColor'), `${name} hardcodes a colour`);
    assert.ok(svg.includes('aria-hidden="true"'), `${name} is not hidden from screen readers`);
    assert.equal((svg.match(/<svg/g) || []).length, 1);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${name} has a broken coordinate`);
    // Coordinates stay short: generated floats like 23.099999999999998 are a smell.
    for (const number of svg.match(/-?\d+\.\d+/g) || []) {
      assert.ok(number.split('.')[1].length <= 2, `${name} has an unrounded coordinate ${number}`);
    }
  }
});

test('an unknown icon name still renders something', () => {
  assert.ok(iconSvg('ei-tällaista').startsWith('<svg'));
});

test('weather codes map to a fitting icon', () => {
  assert.equal(weatherIconName(0), 'clear');
  assert.equal(weatherIconName(2), 'partly');
  assert.equal(weatherIconName(3), 'cloudy');
  assert.equal(weatherIconName(45), 'fog');
  assert.equal(weatherIconName(53), 'drizzle');
  assert.equal(weatherIconName(65), 'rain');
  assert.equal(weatherIconName(82), 'rain');
  assert.equal(weatherIconName(73), 'snow');
  assert.equal(weatherIconName(95), 'thunder');
  assert.equal(weatherIconName(1234), 'cloudy', 'an unknown code must not become a thunderstorm');
});

test('the moon is drawn at its actual phase', () => {
  const newMoon = iconSvg('moon', { phase: 0 });
  const firstQuarter = iconSvg('moon', { phase: 0.25 });
  const full = iconSvg('moon', { phase: 0.5 });
  const lastQuarter = iconSvg('moon', { phase: 0.75 });

  const shapes = new Set([newMoon, firstQuarter, full, lastQuarter]);
  assert.equal(shapes.size, 4, 'each phase must look different');

  // A quarter moon's terminator is a straight line: the inner radius is 0.
  assert.match(firstQuarter, /A0\.00 9\.1/);
  assert.match(lastQuarter, /A0\.00 9\.1/);
  // Waxing and waning curve to opposite sides.
  assert.notEqual(
    firstQuarter.match(/A9\.1 9\.1 0 0 (\d)/)[1],
    lastQuarter.match(/A9\.1 9\.1 0 0 (\d)/)[1],
  );
  // New and full are the extremes of the same drawing.
  assert.match(newMoon, /A9\.10 9\.1/);
  assert.match(full, /A9\.10 9\.1/);

  assert.equal(iconSvg('moon', { phase: 0.25 }), firstQuarter, 'the same phase must render identically');
});
