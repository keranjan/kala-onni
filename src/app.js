/**
 * Kala-Onni – application wiring.
 *
 * Flow: pick a location (geolocation, search or a tap on the map) →
 * load nearby spots from OpenStreetMap → derive the likely species →
 * score the next 48 hours of weather for fishing.
 */

import { DEFAULT_LOCATION } from './config.js';
import { $, cache, debounce, distanceKm, hasPannedAway, formatDistance } from './util.js';
import { createMap } from './map.js';
import { createBottomSheet } from './sheet.js';
import { locateMe, watchLocation, searchPlaces, describeLocation } from './geo.js';
import { fetchSpots, recomputeDistances } from './spots.js';
import { fetchWeather } from './weather.js';
import { scoreHours, upcomingHours, bestWindows } from './score.js';
import { matchSpecies, getSpecies, GENERIC_PROFILE, WATER_TYPES } from './species.js';
import { categoryFor, countByCategory, SPOT_CATEGORIES } from './spot-types.js';
import { renderSpots, renderSpecies, renderWeather, renderSkeletons, renderFilters, toast } from './ui.js';

const CHART_HOURS = 48;

const state = {
  origin: { ...DEFAULT_LOCATION },
  radiusKm: 10,
  spots: [],
  /** Where the user is right now, if they let us follow along. */
  position: null,
  following: false,
  hiddenCategories: new Set(),
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
  mapFilters: $('#map-filters'),
  panelFilters: $('#panel-filters'),
  areaSearch: $('#area-search'),
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
  // Taking hold of the map means "I want to look around", so stop recentring
  // and offer a search of what is now on screen.
  onUserPan: () => {
    if (state.following) setFollowing(false, { keepWatching: true });
  },
  // The centre is only known once the map has come to rest.
  onMoveEnd: () => updateAreaSearchButton(),
});

/** Distances are measured from the user when we know where they are. */
const measuringPoint = () => state.position || state.origin;

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

/** Spots left after the category filters. The map and the list show these. */
const visibleSpots = () => state.spots.filter((spot) => !state.hiddenCategories.has(categoryFor(spot).id));
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
    bits.push(type.label, `${formatDistance(spot.distanceKm)} ${state.position ? 'sinusta' : 'hakupisteestä'}`);
  } else if (state.origin.meta) {
    bits.push(state.origin.meta);
  }
  if (state.speciesId) bits.push(`kohdelaji: ${getSpecies(state.speciesId).name}`);
  dom.placeMeta.textContent = bits.join(' · ');
}

/** Both filter bars – the one on the map and the one in the panel. */
function renderFilterBars() {
  const counts = countByCategory(state.spots);
  for (const container of [dom.mapFilters, dom.panelFilters]) {
    renderFilters(container, {
      counts,
      hidden: state.hiddenCategories,
      onToggle: toggleCategory,
    });
  }
}

function toggleCategory(id) {
  if (state.hiddenCategories.has(id)) state.hiddenCategories.delete(id);
  else state.hiddenCategories.add(id);
  saveHiddenCategories();
  showSpots(state.spots);
}

function clearCategoryFilters() {
  state.hiddenCategories.clear();
  saveHiddenCategories();
  showSpots(state.spots);
}

function saveHiddenCategories() {
  try {
    localStorage.setItem('kalaonni:filters', JSON.stringify([...state.hiddenCategories]));
  } catch { /* filters are a convenience, not state we must keep */ }
}

function loadHiddenCategories() {
  try {
    const stored = JSON.parse(localStorage.getItem('kalaonni:filters') || '[]');
    const known = new Set(SPOT_CATEGORIES.map((category) => category.id));
    return new Set(stored.filter((id) => known.has(id)));
  } catch {
    return new Set();
  }
}

function renderSpotsView() {
  renderSpots(dom.spotsList, {
    spots: visibleSpots(),
    totalCount: state.spots.length,
    selectedId: state.selectedSpot?.id,
    error: state.spotsError,
    notice: state.spotsNotice,
    radiusKm: state.radiusKm,
    onSelect: (spot) => selectSpot(spot, { fly: true }),
    onRetry: () => loadSpots({ force: true }),
    onClearFilters: clearCategoryFilters,
  });
  renderFilterBars();
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
function dismissMapHint({ immediate = false } = {}) {
  if (dom.mapHint.hidden) return;
  dom.mapHint.classList.add('is-hidden');
  // It shares its slot with the "search this area" button, so once that is
  // needed the hint gets out of the way for good.
  if (immediate) dom.mapHint.hidden = true;
  else setTimeout(() => { dom.mapHint.hidden = true; }, 400);
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
  // Measure from where the user is, not from where the search started.
  state.spots = state.position ? recomputeDistances(spots, state.position) : spots;
  spots = state.spots;

  // Re-point the selection at the fresh object. The first, fast half of the
  // search cannot know which lake a pier belongs to; the full result can, and
  // holding on to the older copy froze the species estimate at its vaguest.
  if (state.selectedSpot) {
    const fresh = spots.find((spot) => spot.id === state.selectedSpot.id);
    if (fresh) state.selectedSpot = fresh;
  }

  // The map and the list show what the category filters leave. A spot the
  // user picked stays on the map regardless – whether a smaller radius or a
  // filter would now exclude it – because the whole panel is about that spot.
  const selected = state.selectedSpot;
  const shown = visibleSpots();
  const onMap = selected && !shown.some((spot) => spot.id === selected.id)
    ? [...shown, selected]
    : shown;

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
  dom.areaSearch.hidden = true;
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

/* ------------------------------------------------------ following the user */

let stopWatching = null;
let lastMeasuredFrom = null;

/** Start or stop the position watch. The dot keeps moving while it runs. */
function setWatching(on) {
  if (on === Boolean(stopWatching)) return;
  if (!on) {
    stopWatching?.();
    stopWatching = null;
    return;
  }
  stopWatching = watchLocation({
    onPosition: onPositionUpdate,
    onError: handleWatchError,
  });
}

/** The header button and the map button are one control in two places. */
const locateControls = () => [dom.locate, dom.locateFab];

let warnedAboutFix = false;

/**
 * A dropped fix is not a reason to stop following – it comes back. Only a
 * denied permission ends the tracking, and we say so once.
 */
function handleWatchError(error) {
  if (error.fatal) {
    toast(error.message, { error: true });
    setFollowing(false);
    setWatching(false);
    return;
  }
  if (!state.position && !warnedAboutFix) {
    warnedAboutFix = true;
    toast(`${error.message} Seuranta jatkuu.`);
  }
}

function setFollowing(following, { keepWatching = false } = {}) {
  state.following = following;
  const adrift = !following && Boolean(stopWatching);

  for (const control of locateControls()) {
    control.setAttribute('aria-pressed', String(following));
    control.classList.toggle('is-adrift', adrift);
    control.setAttribute('aria-label', following ? 'Lopeta sijainnin seuranta' : 'Seuraa sijaintiani');
  }
  dom.locate.innerHTML = following
    ? '<span aria-hidden="true">📍</span> Seurataan'
    : `<span aria-hidden="true">📍</span> ${adrift ? 'Keskitä minuun' : 'Paikanna minut'}`;

  if (!following && !keepWatching) setWatching(false);
}

/** A new fix: move the dot, re-measure the spots, and recentre if asked to. */
function onPositionUpdate(position) {
  state.position = position;
  mapView.setUserLocation(position);

  if (state.following) {
    mapView.panTo(position.lat, position.lon, { offsetY: mapOffset() });
    updateAreaSearchButton();
  }

  // Re-measuring on every fix would rewrite the list several times a second.
  const moved = !lastMeasuredFrom || distanceKm(lastMeasuredFrom, position) > 0.02;
  if (moved && state.spots.length) {
    lastMeasuredFrom = position;
    showSpots(state.spots);
  } else if (moved) {
    lastMeasuredFrom = position;
  }
  renderPlaceBar();
}

/**
 * Tap once to follow, again to recentre after panning away, again to stop.
 * That is the behaviour people already know from map apps.
 */
async function toggleFollow() {
  if (!stopWatching) {
    for (const control of locateControls()) {
      control.classList.add('is-busy');
      control.disabled = true;
    }
    try {
      const position = await locateMe();
      onPositionUpdate(position);
      setWatching(true);
      setFollowing(true);
      mapView.panTo(position.lat, position.lon, { offsetY: mapOffset() });
      updateAreaSearchButton();
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      for (const control of locateControls()) {
        control.classList.remove('is-busy');
        control.disabled = false;
      }
    }
    return;
  }

  if (!state.following) {
    setFollowing(true);
    if (state.position) mapView.panTo(state.position.lat, state.position.lon, { offsetY: mapOffset() });
    updateAreaSearchButton();
    return;
  }

  setFollowing(false);
  setWatching(false);
  for (const control of locateControls()) control.classList.remove('is-adrift');
}

/** Offer a new search once the map no longer shows the searched area. */
function updateAreaSearchButton() {
  const away = hasPannedAway(mapView.getCenter(), state.origin, state.radiusKm);
  dom.areaSearch.hidden = !away;
  if (away) dismissMapHint({ immediate: true });
}

dom.areaSearch.addEventListener('click', () => {
  const center = mapView.getCenter();
  dom.areaSearch.hidden = true;
  setFollowing(false, { keepWatching: true });
  setOrigin(center, { label: 'Kartalta valittu alue', lookUpName: true });
});

// A watch in the background drains the battery without telling anyone anything.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setWatching(false);
  else if (state.following) setWatching(true);
});

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

dom.locate.addEventListener('click', toggleFollow);
dom.locateFab.addEventListener('click', toggleFollow);

dom.radius.addEventListener('change', () => {
  state.radiusKm = Number(dom.radius.value);
  // Drop what no longer fits right away, so the map never shows a mix of the
  // old and the new search area while the query runs.
  if (state.spots.length) {
    showSpots(state.spots.filter((spot) => spot.distanceKm <= state.radiusKm));
  }
  mapView.setRadius({ ...state.origin, radiusKm: state.radiusKm });
  mapView.fitTo(state.origin.lat, state.origin.lon, state.radiusKm, { offsetY: mapOffset() });
  updateAreaSearchButton();
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
  state.hiddenCategories = loadHiddenCategories();
  renderFilterBars();
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
      state.position = position;          // distances are measured from here on
      const moved = distanceKm(position, DEFAULT_LOCATION) > 1;
      if (moved) await setOrigin(position, { label: 'Nykyinen sijaintisi', lookUpName: true });
      else showSpots(state.spots);
    } catch {
      dom.mapHint.textContent = 'Salli paikannus, hae paikkakunta tai napauta karttaa';
    }
  }

  setTimeout(() => mapView.invalidate(), 200);
}

boot();
