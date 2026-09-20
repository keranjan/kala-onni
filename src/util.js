/** Small DOM, math, formatting and storage helpers. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element with attributes and children in one call. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Great-circle distance in kilometres. */
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return value.toFixed(decimals).replace('.', ',');
}

const WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const MONTHS = [
  'tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu',
];

export const monthName = (monthIndex) => MONTHS[monthIndex];

/**
 * Open-Meteo returns wall-clock times for the forecast location
 * ("2026-09-19T19:00"). Keep the wall clock for display and derive a real
 * instant with the location's UTC offset so comparisons stay correct even when
 * the browser sits in another timezone.
 */
export function parseApiTime(iso, utcOffsetSeconds = 0) {
  const instant = new Date(`${iso}Z`).getTime() - utcOffsetSeconds * 1000;
  const [datePart, timePart = '00:00'] = iso.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  return {
    iso,
    instant,
    year,
    month,           // 1–12
    day,
    hour,
    minute,
    /** Weekday of the wall-clock date, timezone independent. */
    weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
    clock: `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')}`,
    dateKey: datePart,
  };
}

export function formatDayLabel(time, todayKey, tomorrowKey) {
  if (time.dateKey === todayKey) return 'tänään';
  if (time.dateKey === tomorrowKey) return 'huomenna';
  return `${time.weekday} ${time.day}.${time.month}.`;
}

/** Add days to a YYYY-MM-DD key without timezone drift. */
export function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

const COMPASS = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];
const COMPASS_SHORT = ['P', 'KO', 'I', 'KA', 'E', 'LO', 'L', 'LU'];

export const windDirection = (degrees) => COMPASS[Math.round(degrees / 45) % 8];
export const windDirectionShort = (degrees) => COMPASS_SHORT[Math.round(degrees / 45) % 8];

export function debounce(fn, delay = 350) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Cache keys carry a version. When a stored payload's shape changes, bumping
 * this makes every reader skip the old entries instead of choking on them.
 */
export const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'kalaonni:';

/** localStorage-backed cache; silently degrades when storage is unavailable. */
export const cache = {
  get(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || Date.now() - entry.savedAt > maxAgeMs) return null;
      return entry.value;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
    } catch {
      /* private mode or quota exceeded – caching is optional */
    }
  },
  /**
   * Read an entry regardless of age. Used as a last resort when the network
   * fails: yesterday's spots beat an empty list at the shore.
   */
  getStale(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry) return null;
      return { value: entry.value, ageMs: Date.now() - entry.savedAt };
    } catch {
      return null;
    }
  },
  /** Remove entries written by an earlier version of the app. */
  prune() {
    try {
      const stale = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX) && !key.includes(`:${CACHE_VERSION}:`)) stale.push(key);
      }
      for (const key of stale) localStorage.removeItem(key);
      return stale.length;
    } catch {
      return 0;
    }
  },
};

/**
 * fetch() with a timeout, so a stalled mirror cannot hang the UI.
 * An optional `signal` lets the caller cancel a request whose answer is no
 * longer wanted – a search the user has already moved on from.
 */
export async function fetchWithTimeout(url, { signal, ...options } = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}
