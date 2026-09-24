/**
 * The journal tab and the two forms that feed it: saving a place of your own
 * and logging a catch. Everything here renders from data the caller passes in
 * and reports back through callbacks; storage lives in logbook.js.
 */

import { el, formatDistance, formatNumber } from './util.js';
import { SPECIES } from './species.js';

const WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

const DAYPART_LABEL = {
  aamu: 'aamuhämärä',
  paiva: 'päivä',
  ilta: 'iltahämärä',
  yo: 'yö',
};

/** "ti 24.9." and "18.20" from a stored timestamp. */
function stamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: '', clock: '' };
  return {
    day: `${WEEKDAYS[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}.`,
    clock: `${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

/** The weather a fish was caught in, as one line. */
export function conditionsLine(conditions) {
  if (!conditions) return 'Olosuhteita ei tallennettu';
  const bits = [];
  if (Number.isFinite(conditions.score)) bits.push(`kalaonni ${conditions.score}`);
  if (conditions.daypart) bits.push(DAYPART_LABEL[conditions.daypart] || conditions.daypart);
  if (Number.isFinite(conditions.temp)) bits.push(`${Math.round(conditions.temp)} °C`);
  if (Number.isFinite(conditions.wind)) bits.push(`${formatNumber(conditions.wind, 1)} m/s`);
  if (Number.isFinite(conditions.cloud)) bits.push(`pilvet ${Math.round(conditions.cloud)} %`);
  return bits.join(' · ');
}

/* ----------------------------------------------------------- place form */

export function renderPlaceForm(container, { coords, suggestedName = '', onSave, onCancel }) {
  container.textContent = '';
  if (!coords) return;

  const name = el('input', { type: 'text', id: 'place-name-input', placeholder: 'Esim. Kotilaiturin nokka', value: suggestedName, maxlength: '60' });
  const note = el('input', { type: 'text', id: 'place-note-input', placeholder: 'Esim. kivikko 20 m rannasta', maxlength: '120' });
  const waterType = el('select', { id: 'place-water-input' },
    el('option', { value: 'tuntematon' }, 'Ei tiedossa'),
    el('option', { value: 'jarvi' }, 'Järvi'),
    el('option', { value: 'lampi' }, 'Lampi'),
    el('option', { value: 'joki' }, 'Joki tai koski'),
    el('option', { value: 'meri' }, 'Meri'));

  const form = el('form', {
    class: 'form-card',
    onsubmit: (event) => {
      event.preventDefault();
      onSave({ name: name.value, note: note.value, waterType: waterType.value, ...coords });
    },
  },
    el('h3', {}, '⭐ Tallenna oma paikka'),
    el('div', { class: 'form-sub' },
      `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)} · ${coords.source || 'kartan keskipiste'}`),
    el('div', { class: 'field' }, el('label', { for: 'place-name-input' }, 'Nimi'), name),
    el('div', { class: 'field' }, el('label', { for: 'place-note-input' }, 'Muistiinpano (valinnainen)'), note),
    el('div', { class: 'field' }, el('label', { for: 'place-water-input' }, 'Vesityyppi'), waterType),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Tallenna'),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => onCancel?.() }, 'Peruuta')),
    el('p', { class: 'form-note' },
      'Omat paikat tallentuvat vain tähän laitteeseen. Ota varmuuskopio päiväkirjasta, '
      + 'jos vaihdat puhelinta.'),
  );

  container.append(form);
  name.focus();
}

/* ----------------------------------------------------------- catch form */

export function renderCatchForm(container, { place, species = [], defaultSpeciesId, conditions, onSave, onCancel }) {
  container.textContent = '';

  const options = species.length ? species : SPECIES;
  const speciesSelect = el('select', { id: 'catch-species-input', required: true },
    ...options.map((fish) => el('option', { value: fish.id, selected: fish.id === defaultSpeciesId }, fish.name)));

  const length = el('input', { type: 'number', id: 'catch-length-input', min: '1', max: '250', step: '1', inputmode: 'numeric', placeholder: 'cm' });
  const methods = el('datalist', { id: 'catch-methods' },
    ...[...new Set(options.flatMap((fish) => fish.methods || []))].map((method) => el('option', { value: method })));
  const method = el('input', { type: 'text', id: 'catch-method-input', list: 'catch-methods', placeholder: 'Esim. jigi', maxlength: '40' });
  const note = el('input', { type: 'text', id: 'catch-note-input', placeholder: 'Vapaa muistiinpano', maxlength: '160' });

  const form = el('form', {
    class: 'form-card',
    onsubmit: (event) => {
      event.preventDefault();
      const value = Number(length.value);
      onSave({
        speciesId: speciesSelect.value,
        lengthCm: Number.isFinite(value) && value > 0 ? value : null,
        method: method.value,
        note: note.value,
      });
    },
  },
    el('h3', {}, '🎣 Kirjaa saalis'),
    el('div', { class: 'form-sub' },
      place ? `${place.name} · ${conditionsLine(conditions)}` : `Nykyinen sijainti · ${conditionsLine(conditions)}`),
    el('div', { class: 'field' }, el('label', { for: 'catch-species-input' }, 'Laji'), speciesSelect),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', { for: 'catch-length-input' }, 'Pituus (cm)'), length),
      el('div', { class: 'field' }, el('label', { for: 'catch-method-input' }, 'Pyyntitapa'), method, methods)),
    el('div', { class: 'field' }, el('label', { for: 'catch-note-input' }, 'Muistiinpano (valinnainen)'), note),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Tallenna saalis'),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => onCancel?.() }, 'Peruuta')),
    el('p', { class: 'form-note' },
      'Sää, kalaonni ja vuorokaudenaika tallentuvat automaattisesti – niistä päiväkirja oppii, '
      + 'milloin sinulle tulee kalaa.'),
  );

  container.append(form);
  speciesSelect.focus();
}

/* -------------------------------------------------------------- journal */

export function renderJournal(container, {
  places = [], catches = [], stats, position,
  onShowPlace, onRemovePlace, onRemoveCatch, onStartCatch, onExport, onImport,
}) {
  container.textContent = '';

  // --- what the log knows so far ---------------------------------------
  if (stats) {
    container.append(el('div', { class: 'hero' },
      el('div', { class: 'hero-label' }, 'Saaliita kirjattu'),
      el('div', { class: 'hero-row' },
        el('span', { class: 'hero-value' }, String(stats.count)),
        el('span', { class: 'hero-unit' }, stats.count === 1 ? 'kala' : 'kalaa')),
      el('p', { class: 'hero-why' },
        stats.species.length ? `Yleisin: ${stats.species[0].value} (×${stats.species[0].count}). ` : '',
        stats.bestDaypartLabel ? `Useimmiten ${stats.bestDaypartLabel}. ` : '',
        stats.biggest ? `Suurin: ${stats.biggest.speciesName} ${stats.biggest.lengthCm} cm. ` : '',
        stats.places.length > 1 ? `Paras paikka: ${stats.places[0].value}.` : '')));
  }

  container.append(el('div', { class: 'stat-row' },
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => onStartCatch?.() }, '🎣 Kirjaa saalis'),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => onExport?.() }, 'Vie varmuuskopio'),
    el('label', { class: 'btn btn-ghost', style: 'cursor:pointer' }, 'Tuo varmuuskopio',
      el('input', {
        type: 'file',
        accept: 'application/json,.json',
        style: 'display:none',
        onchange: (event) => {
          const [file] = event.target.files || [];
          if (file) onImport?.(file);
          event.target.value = '';
        },
      }))));

  // --- own places -------------------------------------------------------
  container.append(el('h2', { class: 'section-title' }, 'Omat paikat',
    el('span', { class: 'hint' }, `${places.length} kpl`)));

  if (!places.length) {
    container.append(el('div', { class: 'empty' },
      'Ei omia paikkoja vielä.',
      el('br'),
      'Siirrä kartta haluamaasi kohtaan ja paina Paikat-välilehdellä “⭐ Oma paikka”.'));
  } else {
    const list = el('div', { class: 'list' });
    for (const place of places) {
      const distance = position ? formatDistance(place.distanceKm ?? 0) : null;
      list.append(el('div', { class: 'card journal-place', style: 'cursor:default' },
        el('div', { class: 'journal-entry' },
          el('span', { class: 'journal-when' }, el('b', {}, '⭐')),
          el('span', { class: 'journal-main' },
            el('div', { class: 'journal-title' }, place.name),
            el('div', { class: 'journal-sub' },
              place.note ? `${place.note} · ` : '',
              `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`,
              distance ? ` · ${distance} sinusta` : ''),
            el('div', { style: 'margin-top:8px' },
              el('button', {
                class: 'btn btn-ghost btn-small', type: 'button',
                onclick: () => onShowPlace?.(place),
              }, 'Näytä kartalla'))),
          el('button', {
            class: 'journal-remove', type: 'button',
            'aria-label': `Poista paikka ${place.name}`,
            onclick: () => onRemovePlace?.(place),
          }, '✕'))));
    }
    container.append(list);
  }

  // --- catches ----------------------------------------------------------
  container.append(el('h2', { class: 'section-title' }, 'Saaliit',
    el('span', { class: 'hint' }, `${catches.length} kpl`)));

  if (!catches.length) {
    container.append(el('div', { class: 'empty' },
      'Ei kirjattuja saaliita.',
      el('br'),
      'Kirjaa saalis, niin sovellus alkaa muistaa millä säällä ja mihin aikaan sinulle tulee kalaa.'));
    return;
  }

  const list = el('div', { class: 'list' });
  for (const entry of catches) {
    const when = stamp(entry.at);
    list.append(el('div', { class: 'card journal-catch', style: 'cursor:default' },
      el('div', { class: 'journal-entry' },
        el('span', { class: 'journal-when' }, el('b', {}, when.clock), when.day),
        el('span', { class: 'journal-main' },
          el('div', { class: 'journal-title' },
            entry.speciesName,
            entry.lengthCm ? ` · ${entry.lengthCm} cm` : '',
            entry.method ? ` · ${entry.method}` : ''),
          el('div', { class: 'journal-sub' },
            entry.place?.name ? `${entry.place.name} · ` : '',
            conditionsLine(entry.conditions)),
          entry.note ? el('div', { class: 'journal-sub' }, `”${entry.note}”`) : null),
        el('button', {
          class: 'journal-remove', type: 'button',
          'aria-label': `Poista saalis ${entry.speciesName}`,
          onclick: () => onRemoveCatch?.(entry),
        }, '✕'))));
  }
  container.append(list);

  container.append(el('p', { class: 'form-note' },
    'Päiväkirja on tallessa vain tässä selaimessa. Selaimen tietojen tyhjentäminen poistaa sen, '
    + 'joten ota varmuuskopio silloin tällöin.'));
}
