/**
 * Hourly kalaonni column chart.
 *
 * One series, one colour: the column height carries the value, so colour is
 * not spent on it. Night is a recessive band behind the columns, the best
 * window is annotated directly, and every value is also reachable from the
 * hover tooltip, the keyboard readout and the table view.
 */

import { el } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 18, right: 8, bottom: 26, left: 28 };
const PLOT_HEIGHT = 150;
const MAX_BAR_WIDTH = 14;
const MIN_GAP = 2;

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Column with a rounded data-end and a square foot on the baseline. */
function columnPath(x, y, width, height, radius = 4) {
  const r = Math.min(radius, width / 2, Math.max(height, 0));
  if (height <= 0.5) return `M${x} ${y + height} h${width} v0 h${-width} Z`;
  return `M${x} ${y + height} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} H${x + width - r} A${r} ${r} 0 0 1 ${x + width} ${y + r} V${y + height} Z`;
}

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {Array} options.scored  hourly entries from score.js
 * @param {Array} options.windows best windows from score.js
 * @param {number} options.selectedIndex
 * @param {(index:number)=>void} options.onSelect
 */
export function renderScoreChart(container, { scored, windows = [], selectedIndex = 0, onSelect }) {
  container.textContent = '';
  if (!scored.length) {
    container.append(el('p', { class: 'empty' }, 'Ei ennustetietoja.'));
    return () => {};
  }

  const wrap = el('div', { class: 'chart-wrap' });
  const tooltip = el('div', { class: 'tooltip', hidden: true, role: 'presentation' });
  const readout = el('div', { class: 'chart-readout' });
  container.append(wrap, readout);
  wrap.append(tooltip);

  let index = Math.min(Math.max(selectedIndex, 0), scored.length - 1);
  const peakEntry = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const bestWindow = windows[0] || null;

  const draw = () => {
    const width = Math.max(260, wrap.clientWidth || container.clientWidth || 320);
    const height = PLOT_HEIGHT + PAD.top + PAD.bottom;
    const plotWidth = width - PAD.left - PAD.right;
    const band = plotWidth / scored.length;
    const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, band - MIN_GAP));
    const xOf = (i) => PAD.left + i * band + (band - barWidth) / 2;
    const yOf = (score) => PAD.top + PLOT_HEIGHT * (1 - score / 100);

    const root = svg('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width: '100%',
      height,
      role: 'img',
      'aria-label': `Kalaonni tunneittain, ${scored.length} tuntia. Paras ${peakEntry.score} pistettä kello ${peakEntry.hour.time.clock}.`,
    });

    // --- night bands, behind everything ---------------------------------
    let runStart = null;
    scored.forEach((entry, i) => {
      const isNight = entry.daypart === 'yo';
      if (isNight && runStart === null) runStart = i;
      if ((!isNight || i === scored.length - 1) && runStart !== null) {
        const endIndex = isNight ? i : i - 1;
        root.append(svg('rect', {
          x: PAD.left + runStart * band,
          y: PAD.top,
          width: (endIndex - runStart + 1) * band,
          height: PLOT_HEIGHT,
          fill: 'var(--night-band)',
        }));
        runStart = null;
      }
    });

    // --- gridlines ------------------------------------------------------
    for (const value of [0, 50, 100]) {
      const y = yOf(value);
      root.append(svg('line', {
        x1: PAD.left, x2: width - PAD.right, y1: y, y2: y,
        stroke: value === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
      }));
      root.append(svg('text', {
        x: PAD.left - 6, y: y + 3.5, 'text-anchor': 'end',
        'font-size': 10, fill: 'var(--text-muted)',
      }, String(value)));
    }

    // --- day separators and hour ticks -----------------------------------
    scored.forEach((entry, i) => {
      const { time } = entry.hour;
      if (time.hour === 0 && i > 0) {
        root.append(svg('line', {
          x1: PAD.left + i * band, x2: PAD.left + i * band,
          y1: PAD.top - 6, y2: PAD.top + PLOT_HEIGHT,
          stroke: 'var(--grid)', 'stroke-width': 1,
        }));
      }
      if (time.hour % 6 === 0) {
        root.append(svg('text', {
          x: PAD.left + i * band + band / 2,
          y: PAD.top + PLOT_HEIGHT + 13,
          'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-muted)',
        }, String(time.hour).padStart(2, '0')));
      }
      if (time.hour === 12) {
        root.append(svg('text', {
          x: PAD.left + i * band + band / 2,
          y: PAD.top + PLOT_HEIGHT + 24,
          'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-secondary)',
        }, `${time.weekday} ${time.day}.${time.month}.`));
      }
    });

    // --- best window annotation ------------------------------------------
    if (bestWindow) {
      const from = scored.findIndex((e) => e.hour.time.iso === bestWindow.start.iso);
      const to = scored.findIndex((e) => e.hour.time.iso === bestWindow.end.iso);
      if (from !== -1 && to !== -1) {
        root.append(svg('rect', {
          x: PAD.left + from * band + 1,
          y: PAD.top + PLOT_HEIGHT + 2,
          width: Math.max(4, (to - from + 1) * band - 2),
          height: 3, rx: 1.5, fill: 'var(--accent)',
        }));
      }
    }

    // --- columns ----------------------------------------------------------
    scored.forEach((entry, i) => {
      const y = yOf(entry.score);
      const barHeight = PAD.top + PLOT_HEIGHT - y;
      root.append(svg('path', {
        d: columnPath(xOf(i), y, barWidth, barHeight),
        fill: 'var(--accent)',
        'fill-opacity': i === index ? 1 : 0.85,
        'data-index': i,
      }));
      if (i === index) {
        root.append(svg('rect', {
          x: xOf(i) - 2, y: y - 2, width: barWidth + 4, height: barHeight + 4,
          rx: 5, fill: 'none', stroke: 'var(--accent-ink)', 'stroke-width': 2,
        }));
      }
    });

    // --- one direct label: the peak ---------------------------------------
    const peakIndex = scored.indexOf(peakEntry);
    root.append(svg('text', {
      x: Math.min(Math.max(xOf(peakIndex) + barWidth / 2, PAD.left + 12), width - PAD.right - 12),
      y: yOf(peakEntry.score) - 6,
      'text-anchor': 'middle', 'font-size': 11, 'font-weight': 650, fill: 'var(--text-primary)',
    }, `${peakEntry.score}`));

    // --- pointer surface ---------------------------------------------------
    const hit = svg('rect', {
      x: PAD.left, y: PAD.top, width: plotWidth, height: PLOT_HEIGHT,
      fill: 'transparent', style: 'cursor: crosshair',
    });
    hit.addEventListener('pointermove', (event) => {
      const rect = root.getBoundingClientRect();
      const scale = width / rect.width;
      const localX = (event.clientX - rect.left) * scale - PAD.left;
      const nearest = Math.min(scored.length - 1, Math.max(0, Math.floor(localX / band)));
      select(nearest, { fromPointer: true, clientX: event.clientX, rect });
    });
    hit.addEventListener('pointerleave', () => {
      tooltip.hidden = true;
    });
    hit.addEventListener('click', () => onSelect?.(index));
    root.append(hit);

    wrap.querySelector('svg')?.remove();
    wrap.prepend(root);
    return { width, band, xOf, yOf };
  };

  let geometry = draw();
  let drawnIndex = index;

  function select(next, { fromPointer = false, clientX = 0, rect = null } = {}) {
    index = Math.min(Math.max(next, 0), scored.length - 1);
    const entry = scored[index];
    // Redraw only when the highlighted column actually moves, so dragging the
    // pointer across 48 columns does not rebuild the SVG on every frame.
    if (index !== drawnIndex) {
      geometry = draw();
      drawnIndex = index;
    }

    readout.textContent = '';
    const { hour } = entry;
    readout.append(
      el('span', {}, `${hour.time.weekday} ${hour.time.day}.${hour.time.month}. klo `, el('b', {}, hour.time.clock)),
      el('span', {}, 'Kalaonni ', el('b', {}, `${entry.score}/100`), ` · ${entry.verdict.label}`),
      el('span', {}, `${Math.round(hour.temp)} °C · ${hour.wind.toFixed(1).replace('.', ',')} m/s · pilvet ${Math.round(hour.cloud)} %`),
    );

    if (fromPointer && rect) {
      tooltip.hidden = false;
      tooltip.textContent = '';
      tooltip.append(
        el('div', { class: 'tt-title' }, `${hour.time.weekday} klo ${hour.time.clock}`),
        el('dl', {},
          el('dt', {}, 'Kalaonni'), el('dd', {}, `${entry.score}/100`),
          el('dt', {}, 'Arvio'), el('dd', {}, entry.verdict.label),
          el('dt', {}, 'Lämpötila'), el('dd', {}, `${Math.round(hour.temp)} °C`),
          el('dt', {}, 'Tuuli'), el('dd', {}, `${hour.wind.toFixed(1).replace('.', ',')} m/s`),
          el('dt', {}, 'Sade'), el('dd', {}, `${hour.precip.toFixed(1).replace('.', ',')} mm`),
        ),
      );
      const wrapRect = wrap.getBoundingClientRect();
      const left = clientX - wrapRect.left;
      tooltip.style.left = `${Math.min(Math.max(left - 70, 0), wrapRect.width - 160)}px`;
      tooltip.style.top = '4px';
    }
    return entry;
  }

  container.tabIndex = 0;
  container.setAttribute('role', 'application');
  container.setAttribute('aria-label', 'Kalaonni tunneittain – selaa nuolinäppäimillä');
  container.addEventListener('keydown', (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 6, ArrowDown: -6, PageUp: 24, PageDown: -24 };
    if (event.key in steps) {
      event.preventDefault();
      select(index + steps[event.key]);
      onSelect?.(index);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(0);
      onSelect?.(index);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(scored.length - 1);
      onSelect?.(index);
    }
  });

  select(index);

  const observer = new ResizeObserver(() => {
    geometry = draw();
    drawnIndex = index;
  });
  observer.observe(wrap);

  return () => observer.disconnect();
}

/** Accessible fallback: the same numbers as a table. */
export function renderScoreTable(scored) {
  const table = el('table', { class: 'data' },
    el('caption', { class: 'sr-only' }, 'Kalaonni tunneittain'),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Aika'),
      el('th', { scope: 'col' }, 'Kalaonni'),
      el('th', { scope: 'col' }, 'Arvio'),
      el('th', { scope: 'col' }, '°C'),
      el('th', { scope: 'col' }, 'm/s'),
      el('th', { scope: 'col' }, 'mm'),
    )),
    el('tbody', {}, scored.map((entry) => el('tr', {},
      el('td', {}, `${entry.hour.time.weekday} ${entry.hour.time.clock}`),
      el('td', {}, String(entry.score)),
      el('td', {}, entry.verdict.label),
      el('td', {}, String(Math.round(entry.hour.temp))),
      el('td', {}, entry.hour.wind.toFixed(1).replace('.', ',')),
      el('td', {}, entry.hour.precip.toFixed(1).replace('.', ',')),
    ))),
  );
  return table;
}
