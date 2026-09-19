/** Rendering for the three side-panel views. */

import { el, formatDistance, formatNumber, windDirectionShort, monthName, shiftDateKey, formatDayLabel } from './util.js';
import { WATER_TYPES } from './species.js';
import { describeWeatherCode } from './weather.js';
import { renderScoreChart, renderScoreTable } from './chart.js';

let toastTimer = null;

export function toast(message, { error = false, duration = 6000 } = {}) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.toggle('is-error', error);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, duration);
}

export function renderSkeletons(container, count = 4) {
  container.textContent = '';
  for (let i = 0; i < count; i += 1) container.append(el('div', { class: 'skeleton' }));
}

/* ---------------------------------------------------------------- spots */

export function renderSpots(container, { spots, selectedId, error, radiusKm, onSelect }) {
  container.textContent = '';

  if (error) {
    container.append(el('div', { class: 'note' }, error));
    return;
  }
  if (!spots.length) {
    container.append(el('div', { class: 'empty' },
      `Ei löytynyt kalapaikkoja ${radiusKm} km säteellä.`,
      el('br'),
      'Kasvata sädettä tai siirrä karttaa toiselle alueelle.'));
    return;
  }

  const marked = spots.filter((s) => s.isFishingSpot).length;
  container.append(el('div', { class: 'note' },
    `Löytyi ${spots.length} kohdetta – niistä ${marked} on OpenStreetMapiin merkittyjä kalastuspaikkoja. Valitse kohde nähdäksesi lajit ja kalasään.`));

  for (const spot of spots) {
    const type = WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon;
    container.append(el('button', {
      class: 'card',
      type: 'button',
      'aria-current': spot.id === selectedId ? 'true' : 'false',
      onclick: () => onSelect(spot),
    },
      el('div', { class: 'card-top' },
        el('span', { class: 'card-title' }, spot.name),
        el('span', { class: 'card-dist' }, formatDistance(spot.distanceKm))),
      el('div', { class: 'card-sub' },
        el('span', { class: `badge ${spot.isFishingSpot ? 'badge-spot' : 'badge-water'}` },
          el('i', { class: 'swatch' }), `${type.label}`),
        ...spot.facilities.slice(0, 3).map((f) => el('span', { class: 'badge' }, f)),
        spot.waterTypeSource ? el('span', { class: 'badge' }, `Vesistö: ${spot.waterTypeSource}`) : null),
    ));
  }
}

/* -------------------------------------------------------------- species */

export function renderSpecies(introContainer, listContainer, { spot, species, month, selectedSpeciesId, onSelect }) {
  introContainer.textContent = '';
  listContainer.textContent = '';

  const where = spot ? spot.name : 'valitulla alueella';
  const type = spot ? (WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon).label.toLowerCase() : 'vesialue';

  introContainer.append(
    el('div', {},
      el('strong', {}, `${where} – ${type}, ${monthName(month - 1)}`),
      el('br'),
      'Arvio perustuu vesityyppiin, sijainnin leveysasteeseen ja vuodenaikaan. ',
      'Valitse laji, niin kalasää ja parhaat ajat lasketaan juuri sen mukaan.'),
  );

  if (!species.length) {
    listContainer.append(el('div', { class: 'empty' }, 'Lajitietoa ei löytynyt tälle vesityypille.'));
    return;
  }

  for (const fish of species) {
    const selected = fish.id === selectedSpeciesId;
    const seasonBadgeClass = fish.isClosed ? 'badge badge-crit' : fish.isPeak ? 'badge badge-good' : 'badge';

    const card = el('button', {
      class: 'card',
      type: 'button',
      'aria-current': selected ? 'true' : 'false',
      onclick: () => onSelect(selected ? null : fish.id),
    },
      el('div', { class: 'species-head' },
        el('span', { class: 'species-mark', 'aria-hidden': 'true' }, fish.name.slice(0, 1)),
        el('span', { class: 'card-title' }, fish.name, ' ', el('span', { class: 'latin' }, fish.latin)),
        el('span', { class: 'card-dist' }, `${fish.likelihood} %`)),
      el('div', { class: 'meter', role: 'presentation' }, el('i', { style: `width:${fish.likelihood}%` })),
      el('div', { class: 'card-sub' },
        el('span', { class: seasonBadgeClass }, fish.seasonLabel),
        fish.minSizeCm ? el('span', { class: 'badge' }, `Alamitta ${fish.minSizeCm} cm`) : null,
        el('span', { class: 'badge' }, fish.methods[0])),
      el('div', { class: 'species-body' },
        el('p', { style: 'margin:6px 0 0' }, fish.tip),
        el('dl', { style: 'margin-top:6px' },
          el('dt', {}, 'Pyyntitavat'), el('dd', {}, fish.methods.join(', ')),
          el('dt', {}, 'Parhaat hetket'), el('dd', {}, bestDayparts(fish))),
        fish.isClosed && fish.closedNote
          ? el('p', { class: 'note', style: 'margin:8px 0 0' }, el('strong', {}, '⚠️ Rauhoitusaika. '), fish.closedNote)
          : null,
        fish.closedNote && !fish.isClosed
          ? el('p', { style: 'margin:6px 0 0; color: var(--text-muted)' }, fish.closedNote)
          : null,
        fish.note ? el('p', { style: 'margin:6px 0 0; color: var(--text-muted)' }, fish.note) : null),
    );
    listContainer.append(card);
  }

  listContainer.append(el('div', { class: 'note', style: 'margin-top:12px' },
    el('strong', {}, 'Muista luvat ja säännöt. '),
    '18–69-vuotiaat tarvitsevat valtion kalastonhoitomaksun viehekalastukseen, ja vesialueella voi olla omia lupia ja rajoituksia. ',
    'Tarkista voimassa olevat alamitat ja rauhoitukset ennen lähtöä: ',
    el('a', { href: 'https://kalastusrajoitus.fi', target: '_blank', rel: 'noopener' }, 'kalastusrajoitus.fi'),
    ' ja ',
    el('a', { href: 'https://eraluvat.fi', target: '_blank', rel: 'noopener' }, 'eraluvat.fi'),
    '.'));
}

function bestDayparts(fish) {
  const labels = { aamu: 'aamuhämärä', paiva: 'päivä', ilta: 'iltahämärä', yo: 'yö' };
  return Object.entries(fish.lightPref)
    .filter(([, weight]) => weight >= 0.8)
    .map(([part]) => labels[part])
    .join(', ') || 'vaihtelevasti';
}

/* -------------------------------------------------------------- weather */

export function renderWeather(container, {
  weather, scored, windows, profile, spot, selectedIndex = 0, onSelectHour,
}) {
  container.textContent = '';

  if (!scored.length) {
    container.append(el('div', { class: 'empty' }, 'Sääennustetta ei ole vielä haettu.'));
    return { updateFactors: () => {} };
  }

  const now = scored[0];
  const today = weather.days[0];
  const moon = now.moon;
  const [codeText, codeIcon] = describeWeatherCode(now.hour.code);
  const targetName = profile.name;

  // --- hero: the one number the view leads with -------------------------
  const positives = now.factors.filter((f) => f.delta > 0).slice(0, 2).map((f) => f.note);
  const negatives = now.factors.filter((f) => f.delta < 0).slice(-2).map((f) => f.note);

  container.append(el('div', { class: 'hero' },
    el('div', { class: 'hero-label' }, `Kalaonni juuri nyt · ${targetName}${spot ? ` · ${spot.name}` : ''}`),
    el('div', { class: 'hero-row' },
      el('span', { class: 'hero-value' }, String(now.score)),
      el('span', { class: 'hero-unit' }, '/ 100'),
      el('span', { class: 'hero-verdict' }, now.verdict.label)),
    el('p', { class: 'hero-why' },
      positives.length ? `Puolesta: ${positives.join('; ')}. ` : '',
      negatives.length ? `Vastaan: ${negatives.join('; ')}.` : ''),
  ));

  // --- condition tiles ---------------------------------------------------
  const pressureFactor = now.factors.find((f) => f.id === 'paine');
  container.append(el('div', { class: 'tiles' },
    tile('Sää', `${codeIcon}`, codeText),
    tile('Lämpötila', `${Math.round(now.hour.temp)} °C`, `tuntuu ${Math.round(now.hour.feelsLike)} °C`),
    tile('Tuuli', `${formatNumber(now.hour.wind, 1)} m/s`, `${windDirectionShort(now.hour.windDir)} · puuskat ${formatNumber(now.hour.gust, 0)}`),
    tile('Pilvisyys', `${Math.round(now.hour.cloud)} %`, `sade ${formatNumber(now.hour.precip, 1)} mm/h`),
    tile('Ilmanpaine', `${Math.round(now.hour.pressure)}`, pressureTrendLabel(pressureFactor)),
    tile('Aurinko', `${today.sunrise.clock}`, `laskee ${today.sunset.clock}`),
    tile('Kuu', `${Math.round(moon.illumination * 100)} %`, moon.name),
  ));

  // --- best windows ------------------------------------------------------
  container.append(el('h2', { class: 'section-title' }, 'Parhaat kalastusajat',
    el('span', { class: 'hint' }, 'seuraavat 48 h')));

  const todayKey = weather.days[0].dateKey;
  const tomorrowKey = shiftDateKey(todayKey, 1);

  if (!windows.length) {
    container.append(el('div', { class: 'empty' }, 'Selkeitä huippuhetkiä ei löytynyt – olosuhteet pysyvät tasaisina.'));
  } else {
    const list = el('div', { class: 'list' });
    windows.forEach((window, i) => {
      list.append(el('div', { class: 'card', style: 'cursor:default' },
        el('div', { class: 'window' },
          el('span', { class: 'window-rank', 'aria-hidden': 'true' }, String(i + 1)),
          el('span', { class: 'window-main' },
            el('span', { class: 'window-time' },
              `${formatDayLabel(window.start, todayKey, tomorrowKey)} klo ${window.start.clock}–${window.end.clock}`),
            el('div', { class: 'window-why' },
              `Huippu klo ${window.peakTime.clock}. ${window.reasons.join('. ')}.`)),
          el('span', { class: 'window-score' }, `${window.peakScore}`))));
    });
    container.append(list);
  }

  // --- hourly chart ------------------------------------------------------
  container.append(el('h2', { class: 'section-title' }, 'Kalaonni tunneittain',
    el('span', { class: 'hint' }, '0–100 pistettä')));

  // The chart renders straight into the card so the card itself is the
  // focusable, keyboard-navigable element.
  const chartCard = el('div', { class: 'chart-card' });
  container.append(chartCard);

  const tableHost = el('div', {});
  const tableButton = el('button', { class: 'btn btn-ghost', type: 'button', 'aria-expanded': 'false' }, 'Näytä taulukkona');
  tableButton.addEventListener('click', () => {
    const open = tableHost.childElementCount > 0;
    tableHost.textContent = '';
    if (!open) tableHost.append(renderScoreTable(scored));
    tableButton.textContent = open ? 'Näytä taulukkona' : 'Piilota taulukko';
    tableButton.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  container.append(el('div', { class: 'chart-foot' },
    el('span', { class: 'night-key' }, el('i', {}), 'Yöaika'),
    el('span', {}, 'Sininen viiva = paras jakso'),
    tableButton));
  container.append(tableHost);

  // --- why this hour -----------------------------------------------------
  const factorsTitle = el('h2', { class: 'section-title' }, 'Mistä pisteet muodostuvat');
  const factorsHost = el('div', { class: 'card', style: 'cursor:default' });
  container.append(factorsTitle, factorsHost);

  const updateFactors = (index) => {
    const entry = scored[index] ?? scored[0];
    factorsHost.textContent = '';
    factorsHost.append(
      el('div', { class: 'card-top' },
        el('span', { class: 'card-title' },
          `${entry.hour.time.weekday} ${entry.hour.time.day}.${entry.hour.time.month}. klo ${entry.hour.time.clock}`),
        el('span', { class: 'card-dist' }, `${entry.score}/100 · ${entry.verdict.label}`)),
      el('ul', { class: 'factors' }, entry.factors.map((factor) => el('li', {},
        el('span', { class: `sign ${factor.delta > 0 ? 'pos' : 'neg'}` },
          `${factor.delta > 0 ? '+' : '−'}${Math.abs(Math.round(factor.delta))}`),
        el('span', {}, el('strong', {}, `${factor.label}: `), factor.note)))),
    );
  };

  renderScoreChart(chartCard, {
    scored,
    windows,
    selectedIndex,
    onSelect: (index) => {
      updateFactors(index);
      onSelectHour?.(index);
    },
  });
  updateFactors(selectedIndex);

  container.append(el('div', { class: 'note', style: 'margin-top:16px' },
    el('strong', {}, 'Miten kalaonni lasketaan? '),
    'Lähtöarvo on 50, jota vuorokaudenaika, tuuli, ilmanpaineen muutos, pilvisyys, sade, lämpötila ja kuun vaihe nostavat tai laskevat. ',
    'Laji vaikuttaa painotuksiin. Malli on kalastajan nyrkkisääntö, ei tieteellinen ennuste – ja järvi tuntee oman vetensä paremmin kuin mikään sovellus.'));

  return { updateFactors };
}

function tile(label, value, sub) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'tile-value' }, value),
    el('div', { class: 'tile-sub' }, sub));
}

function pressureTrendLabel(factor) {
  if (!factor) return 'hPa';
  if (factor.note.includes('laskee hitaasti')) return 'hPa · laskee hitaasti';
  if (factor.note.includes('romahtaa')) return 'hPa · laskee nopeasti';
  if (factor.note.includes('nousee jyrkästi')) return 'hPa · nousee nopeasti';
  if (factor.note.includes('nousee')) return 'hPa · nousee';
  return 'hPa · vakaa';
}
