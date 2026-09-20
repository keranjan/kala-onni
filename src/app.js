/**
 * Kala-Onni – application wiring.
 *
 * Flow: pick a location (geolocation, search or a tap on the map) →
 * load nearby spots from OpenStreetMap → derive the likely species →
 * score the next 48 hours of weather for fishing.
 */

import { DEFAULT_LOCATION } from './config.js';
import { $, cache, debounce, distanceKm } from './util.js';
import { createMap } from './map.js';
import { createBottomSheet } from './sheet.js';
import { locateMe, searchPlaces, describeLocation } from './geo.js';
import { fetchSpots } from './spots.js';
import { fetchWeather } from './weather.js';
import { scoreHours, upcomingHours, bestWindows } from './score.js';
import { matchSpecies, getSpecies, GENERIC_PROFILE, WATER_TYPES } from './species.js';
import { renderSpots, renderSpecies, renderWeather, renderSkeletons, toast } from './ui.js';

const CHART_HOURS = 48;

const state = {
  origin: { ...DEFAULT_LOCATION },
  radiusKm: 10,
  spots: [],
  spotsNotice: null,
  selectedSpot: null,
  speciesId: null,
  weather: null,
  scored: [],
  windows: [],
  selectedHour: 0,
  spotsError: null,
};

const dom = {
  placeName: $('#place-name'),
  placeMeta: $('#place-meta'),
  spotsList: $('#spots-list'),
  speciesIntro: $('#species-intro'),
  speciesList: $('#species-list'),
  weather: $('#weather-content'),
  radius: $('#radius-select'),
  refresh: $('#refresh-spots'),
  locate: $('#locate-btn'),
  theme: $('#theme-btn'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  searchResults: $('#search-results'),
  mapHint: $('#map-hint'),
  panel: $('#panel'),
  sheetHandle: $('#sheet-handle'),
  locateFab: $('#locate-fab'),
  install: $('#install-btn'),
  offline: $('#offline-banner'),
};

const mapView = createMap('map', {
  onPick: ({ lat, lon }) => {
    dismissMapHint();
    setOrigin({ lat, lon }, { label: 'Valittu kohta kartalla', lookUpName: true });
  },
});

/** On a phone the panel is a draggable sheet that covers part of the map. */
const sheet = createBottomSheet(dom.panel, {
  handle: dom.sheetHandle,
  onSnap: () => {
    // Leaflet needs to know the visible area changed, after the slide ends.
    setTimeout(() => mapView.invalidate(), 320);
  },
});

/** Pixels of map hidden behind the sheet, so markers stay in view. */
const mapOffset = () => sheet.visibleHeight();

/* ----------------------------------------------------------- derived state */

const activeProfile = () => getSpecies(state.speciesId) || GENERIC_PROFILE;
const weatherPoint = () => state.selectedSpot || state.origin;

const VAGUE_TYPES = ['tuntematon', 'kalapaikka'];

/**
 * The water type the species list is built from. A marked fishing spot often
 * carries no water tags of its own, so fall back to the nearest classified
 * water rather than treating "unknown" as an answer.
 */
function currentWaterType() {
  const selected = state.selectedSpot;
  if (selected && !VAGUE_TYPES.includes(selected.waterType)) return selected.waterType;

  const nearest = state.spots.find((spot) => !VAGUE_TYPES.includes(spot.waterType));
  if (selected) return selected.waterType;        // keep it honest: unknown stays unknown
  return nearest?.waterType || 'tuntematon';
}

/* --------------------------------------------------------------- rendering */

function renderPlaceBar() {
  const spot = state.selectedSpot;
  dom.placeName.textContent = spot ? spot.name : state.origin.name;
  const bits = [];
  if (spot) {
    const type = WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon;
    bits.push(type.label, `${spot.distanceKm.toFixed(1).replace('.', ',')} km sijainnistasi`);
  } else if (state.origin.meta) {
    bits.push(state.origin.meta);
  }
  if (state.speciesId) bits.push(`kohdelaji: ${getSpecies(state.speciesId).name}`);
  dom.placeMeta.textContent = bits.join(' · ');
}

function renderSpotsView() {
  renderSpots(dom.spotsList, {
    spots: state.spots,
    selectedId: state.selectedSpot?.id,
    error: state.spotsError,
    notice: state.spotsNotice,
    radiusKm: state.radiusKm,
    onSelect: (spot) => selectSpot(spot, { fly: true }),
    onRetry: () => loadSpots({ force: true }),
  });
}

/**
 * The score the currently selected hour would have for one species. Cached per
 * forecast, because the species list asks for every species on every render.
 */
const speciesScoreCache = new Map();

function currentScoreForSpecies(speciesId) {
  if (!state.weather) return null;
  if (speciesScoreCache.has(speciesId)) return speciesScoreCache.get(speciesId);

  const profile = getSpecies(speciesId) || GENERIC_PROFILE;
  const all = scoreHours(state.weather, profile);
  const upcoming = upcomingHours(all, state.weather.nowIso);
  const score = (upcoming[0] ?? all[0])?.score ?? null;
  speciesScoreCache.set(speciesId, score);
  return score;
}

function renderSpeciesView() {
  const point = weatherPoint();
  const species = matchSpecies({
    waterType: currentWaterType(),
    lat: point.lat,
    month: new Date().getMonth() + 1,
  });
  renderSpecies(dom.speciesIntro, dom.speciesList, {
    spot: state.selectedSpot,
    species,
    month: new Date().getMonth() + 1,
    waterInfo: {
      type: currentWaterType(),
      source: state.selectedSpot?.waterTypeSource || null,
      guess: Boolean(state.selectedSpot?.waterTypeGuess),
    },
    selectedSpeciesId: state.speciesId,
    onSelect: selectSpecies,
    scoreForSpecies: currentScoreForSpecies,
  });
}

function renderWeatherView() {
  if (!state.weather) return;
  renderWeather(dom.weather, {
    weather: state.weather,
    scored: state.scored,
    windows: state.windows,
    profile: activeProfile(),
    spot: state.selectedSpot,
    selectedIndex: state.selectedHour,
    onSelectHour: (index) => { state.selectedHour = index; },
  });
}

function recomputeScores() {
  if (!state.weather) return;
  const all = scoreHours(state.weather, activeProfile());
  state.scored = upcomingHours(all, state.weather.nowIso).slice(0, CHART_HOURS);
  if (!state.scored.length) state.scored = all.slice(0, CHART_HOURS);
  state.windows = bestWindows(state.scored, { count: 3 });
  state.selectedHour = 0;
}

/* ----------------------------------------------------------------- actions */

/** The map hint is onboarding, not chrome: it steps aside once it is understood. */
function dismissMapHint() {
  dom.mapHint.classList.add('is-hidden');
}

/** What to tell the reader when only part of the search came through. */
function spotsNoticeFor(result) {
  const notes = [];
  if (result.stale) {
    const hours = Math.max(1, Math.round((result.staleAgeMs || 0) / 3600000));
    notes.push(`Overpass ei juuri nyt vastaa – näytetään noin ${hours} h vanhat tiedot.`);
  }
  for (const failure of result.failures) {
    notes.push(`Haku “${failure.name}” ei onnistunut (${failure.reason}).`);
  }
  return notes.length ? notes.join(' ') : null;
}

function showSpots(spots) {
  state.spots = spots;

  // Re-point the selection at the fresh object. The first, fast half of the
  // search cannot know which lake a pier belongs to; the full result can, and
  // holding on to the older copy froze the species estimate at its vaguest.
  if (state.selectedSpot) {
    const fresh = spots.find((spot) => spot.id === state.selectedSpot.id);
    if (fresh) state.selectedSpot = fresh;
  }

  // A spot the user picked stays on the map even if a smaller radius would now
  // exclude it – the whole panel is about that spot.
  const selected = state.selectedSpot;
  const onMap = selected && !spots.some((spot) => spot.id === selected.id)
    ? [...spots, selected]
    : spots;

  mapView.setSpots(onMap, { onSelect: (spot) => selectSpot(spot, { fly: false, focusTab: true }) });
  if (selected) mapView.highlightSpot(selected.id);
  renderSpotsView();
}

/**
 * Only the newest search may touch the map. Changing the radius while one is
 * in flight used to let the older, wider answer land afterwards and repaint
 * spots from outside the new circle.
 */
let spotsRequestCounter = 0;
let spotsInFlight = null;

async function loadSpots() {
  const requestId = ++spotsRequestCounter;
  const isCurrent = () => requestId === spotsRequestCounter;

  spotsInFlight?.abort();                       // stop the search we moved on from
  const controller = new AbortController();
  spotsInFlight = controller;

  state.spotsError = null;
  state.spotsNotice = null;
  renderSkeletons(dom.spotsList, 5);

  try {
    const result = await fetchSpots(state.origin.lat, state.origin.lon, state.radiusKm, {
      signal: controller.signal,
      // The fast half is a first-paint accelerator: show it while the water
      // search runs, but never in place of spots that are already on screen –
      // replacing them and putting them back is what makes the map blink.
      onPartial: (spots) => {
        if (isCurrent() && !state.spots.length) showSpots(spots);
      },
    });
    if (!isCurrent()) return;
    state.spotsNotice = spotsNoticeFor(result);
    showSpots(result.spots);
  } catch (error) {
    if (!isCurrent() || controller.signal.aborted) return;
    state.spots = [];
    state.spotsError = error.message;
    showSpots([]);
    toast('Kalapaikkojen haku ei onnistunut.', { error: true });
  } finally {
    if (isCurrent()) spotsInFlight = null;
  }

  if (!isCurrent()) return;
  renderSpeciesView();
  setTimeout(dismissMapHint, 6000);
}

async function loadWeather() {
  const point = weatherPoint();
  dom.weather.textContent = '';
  renderSkeletons(dom.weather, 3);
  try {
    state.weather = await fetchWeather(point.lat, point.lon);
    speciesScoreCache.clear();
    recomputeScores();
    renderWeatherView();
    renderSpeciesView();
  } catch (error) {
    dom.weather.textContent = '';
    dom.weather.append(Object.assign(document.createElement('div'), {
      className: 'note',
      textContent: `Sääennustetta ei saatu: ${error.message}`,
    }));
    toast('Sääennustetta ei saatu haettua.', { error: true });
  }
}

async function setOrigin({ lat, lon, accuracy = null }, { label = null, lookUpName = false, name = null } = {}) {
  state.origin = { lat, lon, name: name || label || 'Valittu sijainti', meta: label && name ? label : '' };
  state.selectedSpot = null;
  state.selectedHour = 0;

  mapView.setUserLocation({ lat, lon, accuracy });
  mapView.setRadius({ lat, lon, radiusKm: state.radiusKm });
  mapView.fitTo(lat, lon, state.radiusKm, { offsetY: mapOffset() });
  renderPlaceBar();
  writeHash();

  const jobs = [loadSpots(), loadWeather()];

  if (lookUpName || !name) {
    describeLocation(lat, lon).then((place) => {
      if (!place) return;
      state.origin.name = place;
      state.origin.meta = label || '';
      renderPlaceBar();
    });
  }

  await Promise.all(jobs);
}

function selectSpot(spot, { fly = true, focusTab = false } = {}) {
  state.selectedSpot = spot;
  state.selectedHour = 0;
  mapView.highlightSpot(spot.id, { openPopup: true });
  if (fly) mapView.flyTo(spot.lat, spot.lon, 13, { offsetY: mapOffset() });
  sheet.expand();
  renderPlaceBar();
  renderSpotsView();
  renderSpeciesView();
  if (focusTab || fly) showTab('species');
  // The forecast is spot-specific: a lake 20 km away can have its own weather.
  loadWeather();
}

function selectSpecies(speciesId) {
  state.speciesId = speciesId;
  renderPlaceBar();
  renderSpeciesView();
  recomputeScores();
  renderWeatherView();
  if (speciesId) showTab('weather');
}

/* -------------------------------------------------------------------- tabs */

const TABS = ['spots', 'species', 'weather'];

function showTab(name) {
  for (const tab of TABS) {
    const button = document.getElementById(`tab-${tab}`);
    const view = document.getElementById(`view-${tab}`);
    const active = tab === name;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    view.hidden = !active;
  }
}

for (const tab of TABS) {
  const button = document.getElementById(`tab-${tab}`);
  button.addEventListener('click', () => {
    showTab(tab);
    sheet.expand();
  });
  button.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    showTab(next);
    document.getElementById(`tab-${next}`).focus();
  });
}

/* ---------------------------------------------------------------- controls */

async function runLocate() {
  dom.locate.disabled = true;
  dom.locate.textContent = 'Paikannetaan…';
  dom.locateFab.classList.add('is-busy');
  dom.locateFab.disabled = true;
  try {
    const position = await locateMe();
    await setOrigin(position, { label: 'Nykyinen sijaintisi', lookUpName: true });
  } catch (error) {
    toast(error.message, { error: true });
  } finally {
    dom.locate.disabled = false;
    dom.locate.innerHTML = '<span aria-hidden="true">📍</span> Paikanna minut';
    dom.locateFab.classList.remove('is-busy');
    dom.locateFab.disabled = false;
  }
}

dom.locate.addEventListener('click', runLocate);
dom.locateFab.addEventListener('click', runLocate);

dom.radius.addEventListener('change', () => {
  state.radiusKm = Number(dom.radius.value);
  // Drop what no longer fits right away, so the map never shows a mix of the
  // old and the new search area while the query runs.
  if (state.spots.length) {
    showSpots(state.spots.filter((spot) => spot.distanceKm <= state.radiusKm));
  }
  mapView.setRadius({ ...state.origin, radiusKm: state.radiusKm });
  mapView.fitTo(state.origin.lat, state.origin.lon, state.radiusKm, { offsetY: mapOffset() });
  writeHash();
  loadSpots();
});

dom.refresh.addEventListener('click', () => loadSpots());

dom.theme.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : current === 'light' ? '' : 'dark';
  if (next) document.documentElement.setAttribute('data-theme', next);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('kalaonni:theme', next); } catch { /* ignore */ }
});

const runSearch = debounce(async (query) => {
  if (query.trim().length < 3) {
    dom.searchResults.hidden = true;
    return;
  }
  try {
    const hits = await searchPlaces(query);
    dom.searchResults.textContent = '';
    if (!hits.length) {
      dom.searchResults.hidden = true;
      toast('Haulla ei löytynyt paikkoja.');
      return;
    }
    for (const hit of hits) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `${escapeHtml(hit.name)}<span class="hit-sub">${escapeHtml(hit.description)}</span>`;
      button.addEventListener('click', () => {
        dom.searchResults.hidden = true;
        dom.searchInput.value = hit.name;
        dom.searchInput.blur();
        setOrigin({ lat: hit.lat, lon: hit.lon }, { name: hit.name, label: hit.description });
      });
      item.append(button);
      dom.searchResults.append(item);
    }
    dom.searchResults.hidden = false;
  } catch (error) {
    toast(error.message, { error: true });
  }
}, 450);

dom.searchInput.addEventListener('input', (event) => runSearch(event.target.value));
dom.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(dom.searchInput.value);
});
document.addEventListener('click', (event) => {
  if (!dom.searchForm.contains(event.target)) dom.searchResults.hidden = true;
});

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/* ------------------------------------- install, connection, service worker */

let installPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  // Keep the browser's own banner away and offer installing on our terms.
  event.preventDefault();
  installPrompt = event;
  dom.install.hidden = false;
});

dom.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  dom.install.hidden = true;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === 'accepted') toast('Kala-Onni lisättiin laitteeseesi.');
});

window.addEventListener('appinstalled', () => {
  dom.install.hidden = true;
  installPrompt = null;
});

function updateConnectionState() {
  dom.offline.hidden = navigator.onLine;
}
window.addEventListener('online', updateConnectionState);
window.addEventListener('offline', updateConnectionState);

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus, never a blocker */
    });
  });
}

/* ------------------------------------------------------- shareable location */

function writeHash() {
  const { lat, lon } = state.origin;
  const hash = `#${lat.toFixed(4)},${lon.toFixed(4)},${state.radiusKm}`;
  if (window.location.hash !== hash) history.replaceState(null, '', hash);
}

function readHash() {
  const parts = window.location.hash.replace('#', '').split(',').map(Number);
  if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    const radius = Number.isFinite(parts[2]) ? parts[2] : 10;
    return { lat: parts[0], lon: parts[1], radiusKm: [5, 10, 25, 50].includes(radius) ? radius : 10 };
  }
  return null;
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  try {
    const savedTheme = localStorage.getItem('kalaonni:theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  } catch { /* ignore */ }

  cache.prune();          // drop entries written by an older version
  showTab('spots');
  updateConnectionState();
  registerServiceWorker();

  const fromHash = readHash();
  if (fromHash) {
    state.radiusKm = fromHash.radiusKm;
    dom.radius.value = String(fromHash.radiusKm);
    await setOrigin(fromHash, { label: 'Jaettu sijainti', lookUpName: true });
  } else {
    // Show something useful immediately, then upgrade to the real position.
    setOrigin(DEFAULT_LOCATION, { name: DEFAULT_LOCATION.name, label: DEFAULT_LOCATION.meta });
    try {
      const position = await locateMe({ timeout: 8000 });
      const moved = distanceKm(position, DEFAULT_LOCATION) > 1;
      if (moved) await setOrigin(position, { label: 'Nykyinen sijaintisi', lookUpName: true });
    } catch {
      dom.mapHint.textContent = 'Salli paikannus, hae paikkakunta tai napauta karttaa';
    }
  }

  setTimeout(() => mapView.invalidate(), 200);
}

boot();
