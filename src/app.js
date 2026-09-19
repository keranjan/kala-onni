/**
 * Kala-Onni – application wiring.
 *
 * Flow: pick a location (geolocation, search or a tap on the map) →
 * load nearby spots from OpenStreetMap → derive the likely species →
 * score the next 48 hours of weather for fishing.
 */

import { DEFAULT_LOCATION } from './config.js';
import { $, debounce, distanceKm } from './util.js';
import { createMap } from './map.js';
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
};

const mapView = createMap('map', {
  onPick: ({ lat, lon }) => setOrigin({ lat, lon }, { label: 'Valittu kohta kartalla', lookUpName: true }),
});

/* ----------------------------------------------------------- derived state */

const activeProfile = () => getSpecies(state.speciesId) || GENERIC_PROFILE;
const weatherPoint = () => state.selectedSpot || state.origin;

function currentWaterType() {
  if (state.selectedSpot) return state.selectedSpot.waterType;
  // No spot picked yet: describe the nearest water we know about.
  const nearest = state.spots.find((spot) => spot.waterType !== 'tuntematon');
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
    radiusKm: state.radiusKm,
    onSelect: (spot) => selectSpot(spot, { fly: true }),
  });
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
    selectedSpeciesId: state.speciesId,
    onSelect: selectSpecies,
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

async function loadSpots() {
  state.spotsError = null;
  renderSkeletons(dom.spotsList, 5);
  try {
    const spots = await fetchSpots(state.origin.lat, state.origin.lon, state.radiusKm);
    state.spots = spots;
    mapView.setSpots(spots, { onSelect: (spot) => selectSpot(spot, { fly: false, focusTab: true }) });
    if (state.selectedSpot) mapView.highlightSpot(state.selectedSpot.id);
  } catch (error) {
    state.spots = [];
    state.spotsError = error.message;
    mapView.setSpots([]);
    toast(error.message, { error: true });
  }
  renderSpotsView();
  renderSpeciesView();
}

async function loadWeather() {
  const point = weatherPoint();
  dom.weather.textContent = '';
  renderSkeletons(dom.weather, 3);
  try {
    state.weather = await fetchWeather(point.lat, point.lon);
    recomputeScores();
    renderWeatherView();
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
  mapView.fitTo(lat, lon, state.radiusKm);
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
  mapView.highlightSpot(spot.id, { openPopup: !fly });
  if (fly) mapView.flyTo(spot.lat, spot.lon, 13);
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
  button.addEventListener('click', () => showTab(tab));
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

dom.locate.addEventListener('click', async () => {
  dom.locate.disabled = true;
  dom.locate.textContent = 'Paikannetaan…';
  try {
    const position = await locateMe();
    await setOrigin(position, { label: 'Nykyinen sijaintisi', lookUpName: true });
  } catch (error) {
    toast(error.message, { error: true });
  } finally {
    dom.locate.disabled = false;
    dom.locate.innerHTML = '<span aria-hidden="true">📍</span> Paikanna minut';
  }
});

dom.radius.addEventListener('change', () => {
  state.radiusKm = Number(dom.radius.value);
  mapView.setRadius({ ...state.origin, radiusKm: state.radiusKm });
  mapView.fitTo(state.origin.lat, state.origin.lon, state.radiusKm);
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

  showTab('spots');

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
