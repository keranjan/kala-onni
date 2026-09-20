/**
 * Inline SVG icons for the weather tiles.
 *
 * Stroke-based and drawn in `currentColor`, so they follow the theme and stay
 * sharp at any density – an emoji would render differently on every platform
 * and cannot take a colour. Icons are decorative: the label beside them
 * carries the meaning, so they are hidden from assistive technology.
 */

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const wrap = (body) => `${SVG_OPEN}${body}</svg>`;

/** The eight rays of a sun, as one path. */
const RAYS = [
  'M12 2.6v2.1', 'M12 19.3v2.1', 'M2.6 12h2.1', 'M19.3 12h2.1',
  'M5.4 5.4l1.5 1.5', 'M17.1 17.1l1.5 1.5', 'M5.4 18.6l1.5-1.5', 'M17.1 6.9l1.5-1.5',
].map((d) => `<path d="${d}"/>`).join('');

const CLOUD = '<path d="M7 18h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2A3.9 3.9 0 0 0 7 18Z"/>';

const ICONS = {
  clear: wrap(`<circle cx="12" cy="12" r="4.2"/>${RAYS}`),
  partly: wrap('<circle cx="9" cy="8.5" r="3.1"/><path d="M9 2.6v1.6M3.6 8.5h1.6M5.2 4.7l1.1 1.1M12.8 4.7l-1.1 1.1"/>'
    + '<path d="M9 19h7.6a3.2 3.2 0 0 0 .2-6.4 4.6 4.6 0 0 0-8.8-1.1A3.6 3.6 0 0 0 9 19Z"/>'),
  cloudy: wrap(CLOUD),
  fog: wrap(`${CLOUD}<path d="M5 21h6M13.5 21h5.5"/>`),
  drizzle: wrap(`${CLOUD}<path d="M9 20.4v1.2M13 20.4v1.2"/>`),
  rain: wrap(`${CLOUD}<path d="M9 20v1.8M12.6 20v1.8M16.2 20v1.8"/>`),
  // Six-point flakes, drawn thinner than the cloud so they stay open.
  snow: wrap(`${CLOUD}`
    + '<path stroke-width="1.15" d="M8.8 18.9v4.4M6.9 20l3.8 2.2M6.9 22.2l3.8-2.2"/>'
    + '<path stroke-width="1.15" d="M15.2 18.9v4.4M13.3 20l3.8 2.2M13.3 22.2l3.8-2.2"/>'),
  thunder: wrap('<path d="M6.8 15.8h8.9a3.2 3.2 0 0 0 .2-6.4 4.6 4.6 0 0 0-8.8-1.1 3.6 3.6 0 0 0-.3 7.5Z"/>'
    + '<path d="M12.9 16.4 10.4 20.1h2.7l-1.8 3.3"/>'),

  thermometer: wrap('<path d="M10 13.6V5.5a2 2 0 0 1 4 0v8.1a4 4 0 1 1-4 0Z"/><path d="M12 9.5v5.6"/>'),
  wind: wrap('<path d="M3 8.5h9.5A2.5 2.5 0 1 0 10 6"/><path d="M3 12.5h13a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16.5h6"/>'),
  cloudCover: wrap('<path d="M6.5 16.5h8.8a3.2 3.2 0 0 0 .2-6.4 4.6 4.6 0 0 0-8.8-1.1 3.6 3.6 0 0 0-.2 7.5Z"/><path d="M8 20h9"/>'),
  pressure: wrap('<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="m12 17 4-5.2"/><circle cx="12" cy="17" r="1.2"/>'),

  sunrise: wrap('<circle cx="12" cy="14.5" r="3.4"/><path d="M3.5 19h17"/>'
    + '<path d="M12 3.2v4.2M9.3 6.1 12 3.2l2.7 2.9"/><path d="M4.6 12.5 5.8 13.7M19.4 12.5l-1.2 1.2"/>'),
  sunset: wrap('<circle cx="12" cy="14.5" r="3.4"/><path d="M3.5 19h17"/>'
    + '<path d="M12 7.4V3.2M9.3 4.5 12 7.4l2.7-2.9"/><path d="M4.6 12.5 5.8 13.7M19.4 12.5l-1.2 1.2"/>'),
  daylength: wrap('<path d="M3.5 18.5h17"/><path d="M5.5 18.5a6.5 6.5 0 0 1 13 0"/>'
    + '<circle cx="12" cy="9.2" r="2.2"/><path d="M12 3.4v1.6M6.6 6l1.1 1.1M17.4 6l-1.1 1.1"/>'),

  gust: wrap('<path d="M4 9h8.5A2.5 2.5 0 1 0 10 6.5"/><path d="M4 14h6"/><path d="M13 14h3.5a2.5 2.5 0 1 1-2.5 2.5"/>'),
};

/**
 * The moon, drawn at its actual phase: the lit limb is filled, the rest is a
 * faint disc. `phase` is 0 at new moon and 0.5 at full moon.
 */
const MOON_RADIUS = 9.1;

function moonIcon(phase = 0) {
  const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;   // illuminated fraction
  const waxing = phase < 0.5;
  // The terminator is an ellipse across the same disc, so it shares its radius.
  const rx = Math.abs(MOON_RADIUS * (2 * lit - 1)).toFixed(2);
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = lit > 0.5 ? outerSweep : 1 - outerSweep;

  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
    + `<circle cx="12" cy="12" r="${MOON_RADIUS}" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>`
    + `<path d="M12 2.9 A${MOON_RADIUS} ${MOON_RADIUS} 0 0 ${outerSweep} 12 21.1 `
    + `A${rx} ${MOON_RADIUS} 0 0 ${innerSweep} 12 2.9 Z" `
    + 'fill="currentColor" stroke="none"/></svg>';
}

/** WMO weather code → the icon that fits it. */
export function weatherIconName(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || code === 80 || code === 81 || code === 82) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'cloudy';
}

/** SVG markup for an icon; `moon` takes the phase as an option. */
export function iconSvg(name, { phase = 0 } = {}) {
  if (name === 'moon') return moonIcon(phase);
  return ICONS[name] || ICONS.cloudy;
}

export const ICON_NAMES = [...Object.keys(ICONS), 'moon'];
