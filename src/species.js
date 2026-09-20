/**
 * Finnish freshwater and Baltic species, with the habitat, season and weather
 * preferences the scoring model needs.
 *
 * `lightPref`   0–1 weight per daypart (aamu = dawn, paiva = day, ilta = dusk, yo = night)
 * `windIdeal`   [min, max] m/s that suits the species
 * `cloudPref`   'pilvinen' | 'vaihteleva' | 'kirkas'
 * `pressurePref`'lasku' | 'vakaa' | 'nousu'
 * `tempIdeal`   [min, max] °C air temperature used as a water-temperature proxy
 *
 * Sizes and closed seasons are the common national baseline. Regional rules
 * override them, so every view links the reader to the official sources.
 */

export const WATER_TYPES = {
  jarvi: { label: 'Järvi', icon: '🏞️' },
  lampi: { label: 'Lampi', icon: '💧' },
  tekojarvi: { label: 'Tekojärvi', icon: '🏞️' },
  joki: { label: 'Joki', icon: '🌊' },
  puro: { label: 'Puro', icon: '🌿' },
  kanava: { label: 'Kanava', icon: '🚤' },
  meri: { label: 'Meri', icon: '⚓' },
  kalapaikka: { label: 'Kalastuspaikka', icon: '🎣' },
  tuntematon: { label: 'Vesialue', icon: '💦' },
};

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const SPECIES = [
  {
    id: 'ahven',
    abundance: 1,
    name: 'Ahven',
    latin: 'Perca fluviatilis',
    waters: ['jarvi', 'lampi', 'tekojarvi', 'joki', 'kanava', 'meri'],
    latRange: [59.5, 70.2],
    activeMonths: ALL_MONTHS,
    peakMonths: [6, 7, 8, 9, 10],
    methods: ['Jigi', 'Vaappu', 'Mato-onki', 'Pilkki'],
    tip: 'Etsi kivikkomatalikoita, niemenkärkiä ja jyrkänteiden reunoja. Loppukesällä parvet ryöstävät pinnassa – seuraa lokkeja.',
    lightPref: { aamu: 0.9, paiva: 0.75, ilta: 0.95, yo: 0.15 },
    windIdeal: [1, 5],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [10, 22],
  },
  {
    id: 'hauki',
    abundance: 0.95,
    name: 'Hauki',
    latin: 'Esox lucius',
    waters: ['jarvi', 'lampi', 'tekojarvi', 'joki', 'kanava', 'meri'],
    latRange: [59.5, 70.2],
    activeMonths: ALL_MONTHS,
    peakMonths: [5, 6, 9, 10, 11],
    methods: ['Jerkki', 'Kumikala', 'Lusikka', 'Perhokalastus'],
    tip: 'Kasvillisuuden reunat, kaislikot ja matalikot. Syksyn viileä vesi ja laskeva ilmanpaine saavat isot naaraat liikkeelle.',
    note: 'Kutuaikaan huhti–toukokuussa isot naaraat kannattaa vapauttaa.',
    lightPref: { aamu: 0.85, paiva: 0.7, ilta: 0.9, yo: 0.2 },
    windIdeal: [2, 8],
    cloudPref: 'pilvinen',
    pressurePref: 'lasku',
    tempIdeal: [4, 18],
  },
  {
    id: 'kuha',
    abundance: 0.68,
    name: 'Kuha',
    latin: 'Sander lucioperca',
    waters: ['jarvi', 'tekojarvi', 'joki', 'meri'],
    latRange: [59.5, 65.5],
    activeMonths: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    peakMonths: [6, 7, 8, 9],
    minSizeCm: 42,
    methods: ['Vertikaali', 'Jigi', 'Uistelu', 'Yövaappu'],
    tip: 'Sameat ja rehevät vedet, syvänteiden rinteet. Parhaat hetket hämärässä ja tuulisella säällä, kun vesi on pinnasta sekoittunut.',
    lightPref: { aamu: 0.85, paiva: 0.3, ilta: 1.0, yo: 0.8 },
    windIdeal: [3, 9],
    cloudPref: 'pilvinen',
    pressurePref: 'vakaa',
    tempIdeal: [14, 24],
  },
  {
    id: 'taimen',
    abundance: 0.42,
    name: 'Taimen',
    latin: 'Salmo trutta',
    waters: ['joki', 'puro', 'jarvi', 'meri'],
    latRange: [59.5, 70.2],
    activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 12],
    peakMonths: [5, 6, 8],
    minSizeCm: 60,
    closedMonths: [9, 10, 11],
    closedNote: 'Virtavesissä taimen on rauhoitettu 1.9.–30.11. Rasvaeväleikatut istukkaat ovat monin paikoin poikkeus – tarkista alueen säännöt.',
    methods: ['Perhokalastus', 'Kevytuistelu', 'Vaappu'],
    tip: 'Virtapaikkojen kuopat, kivien takaiset suvannot ja koskien niskat. Pilvinen, kostea ja tyyni ilma on parasta taimensäätä.',
    lightPref: { aamu: 1.0, paiva: 0.5, ilta: 1.0, yo: 0.45 },
    windIdeal: [0.5, 5],
    cloudPref: 'pilvinen',
    pressurePref: 'lasku',
    tempIdeal: [4, 16],
  },
  {
    id: 'kirjolohi',
    abundance: 0.34,
    name: 'Kirjolohi',
    latin: 'Oncorhynchus mykiss',
    waters: ['lampi', 'jarvi', 'joki', 'tekojarvi'],
    latRange: [59.5, 70.2],
    activeMonths: ALL_MONTHS,
    peakMonths: [4, 5, 9, 10, 11],
    methods: ['Perhokalastus', 'Kelluke', 'Lusikka', 'Pilkki'],
    tip: 'Tyypillinen istuta ja ongi -kohteiden laji. Istutuksen jälkeiset päivät ovat parhaita; kalat kiertävät usein rantojen lähellä.',
    lightPref: { aamu: 0.9, paiva: 0.65, ilta: 0.9, yo: 0.3 },
    windIdeal: [1, 6],
    cloudPref: 'pilvinen',
    pressurePref: 'vakaa',
    tempIdeal: [2, 16],
  },
  {
    id: 'harjus',
    abundance: 0.5,
    name: 'Harjus',
    latin: 'Thymallus thymallus',
    waters: ['joki', 'puro', 'jarvi'],
    latRange: [62.0, 70.2],
    activeMonths: [6, 7, 8, 9, 10, 11, 12, 1, 2, 3],
    peakMonths: [6, 7, 8],
    minSizeCm: 35,
    closedMonths: [4, 5],
    closedNote: 'Harjus on rauhoitettu 1.4.–31.5. leveyspiirin 67°00′N eteläpuolella.',
    methods: ['Kuivaperho', 'Nymfi', 'Pilkki'],
    tip: 'Virran nopeat niskat ja soraikot. Kuoriutumiset iltapäivällä ja illalla nostavat harjukset pintaan.',
    lightPref: { aamu: 0.7, paiva: 0.8, ilta: 1.0, yo: 0.25 },
    windIdeal: [0.5, 4],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [6, 18],
  },
  {
    id: 'siika',
    abundance: 0.6,
    name: 'Siika',
    latin: 'Coregonus lavaretus',
    waters: ['jarvi', 'joki', 'meri', 'tekojarvi'],
    latRange: [59.5, 70.2],
    activeMonths: ALL_MONTHS,
    peakMonths: [6, 7, 9, 10],
    methods: ['Verkko (luvanvarainen)', 'Pilkki', 'Perho', 'Uistelu'],
    tip: 'Ulapan matalikot ja rantavyöhykkeen hiekkapohjat. Syksyllä siika nousee kutupaikoille matalaan.',
    lightPref: { aamu: 0.9, paiva: 0.6, ilta: 0.9, yo: 0.35 },
    windIdeal: [1, 6],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [4, 18],
  },
  {
    id: 'made',
    abundance: 0.58,
    name: 'Made',
    latin: 'Lota lota',
    waters: ['jarvi', 'joki', 'tekojarvi', 'meri'],
    latRange: [59.5, 70.2],
    activeMonths: [11, 12, 1, 2, 3, 4],
    peakMonths: [12, 1, 2],
    methods: ['Mateenkoukku', 'Pilkki', 'Pohjaonki'],
    tip: 'Talven kutuaikaan made liikkuu matalilla soraikoilla. Pimeä ja pakkasyö on parasta madeaikaa.',
    lightPref: { aamu: 0.4, paiva: 0.15, ilta: 0.7, yo: 1.0 },
    windIdeal: [0, 6],
    cloudPref: 'pilvinen',
    pressurePref: 'vakaa',
    tempIdeal: [-15, 6],
  },
  {
    id: 'lahna',
    abundance: 0.68,
    name: 'Lahna',
    latin: 'Abramis brama',
    waters: ['jarvi', 'lampi', 'tekojarvi', 'joki', 'kanava'],
    latRange: [59.5, 66.0],
    activeMonths: [5, 6, 7, 8, 9],
    peakMonths: [6, 7],
    methods: ['Pohjaonki', 'Feeder', 'Mato-onki'],
    tip: 'Pehmeäpohjaiset lahdet ja ruovikon reunat. Lämpimät, tyynet kesäyöt ovat lahnan parasta aikaa.',
    lightPref: { aamu: 0.9, paiva: 0.4, ilta: 0.95, yo: 0.85 },
    windIdeal: [0, 4],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [15, 26],
  },
  {
    id: 'sarki',
    abundance: 0.95,
    name: 'Särki',
    latin: 'Rutilus rutilus',
    waters: ['jarvi', 'lampi', 'tekojarvi', 'joki', 'kanava', 'meri'],
    latRange: [59.5, 68.0],
    activeMonths: [4, 5, 6, 7, 8, 9, 10],
    peakMonths: [5, 6, 7, 8],
    methods: ['Mato-onki', 'Kelluke', 'Leipätaikina'],
    tip: 'Helppo aloittelijan ja lasten kala. Laiturit ja rantojen kasvillisuus tuottavat lähes aina.',
    lightPref: { aamu: 0.85, paiva: 0.8, ilta: 0.85, yo: 0.2 },
    windIdeal: [0, 5],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [10, 24],
  },
  {
    id: 'sayne',
    abundance: 0.5,
    name: 'Säyne',
    latin: 'Leuciscus idus',
    waters: ['joki', 'jarvi', 'kanava', 'meri'],
    latRange: [59.5, 65.5],
    activeMonths: [4, 5, 6, 7, 8, 9],
    peakMonths: [5, 6, 7],
    methods: ['Perhokalastus', 'Kelluke', 'Pieni vaappu'],
    tip: 'Virtaavan veden suvannot ja siltojen alukset. Säyne nousee pintaan syömään hyönteisiä tyyninä iltoina.',
    lightPref: { aamu: 0.9, paiva: 0.7, ilta: 0.95, yo: 0.3 },
    windIdeal: [0, 4],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [12, 24],
  },
  {
    id: 'nieria',
    abundance: 0.42,
    name: 'Nieriä (rautu)',
    latin: 'Salvelinus alpinus',
    waters: ['jarvi', 'joki'],
    latRange: [66.5, 70.2],
    activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 12],
    peakMonths: [6, 7, 8],
    minSizeCm: 45,
    closedMonths: [9, 10, 11],
    closedNote: 'Nieriä on rauhoitettu syyskutuaikaan; Vuoksen vesistön järvinieriä on kokonaan rauhoitettu.',
    methods: ['Uistelu', 'Perhokalastus', 'Pilkki'],
    tip: 'Pohjoisten suurten järvien selkävedet ja jyrkät rantarinteet. Nieriä viihtyy kylmässä vedessä.',
    lightPref: { aamu: 0.95, paiva: 0.55, ilta: 1.0, yo: 0.4 },
    windIdeal: [1, 6],
    cloudPref: 'pilvinen',
    pressurePref: 'vakaa',
    tempIdeal: [0, 14],
  },
  {
    id: 'lohi',
    abundance: 0.3,
    name: 'Lohi',
    latin: 'Salmo salar',
    waters: ['joki', 'meri'],
    latRange: [60.0, 70.2],
    activeMonths: [5, 6, 7, 8],
    peakMonths: [6, 7],
    minSizeCm: 60,
    closedNote: 'Lohenkalastusta säädellään jokikohtaisesti ja kaudet vaihtelevat vuosittain – tarkista aina voimassa olevat luvat ja kiintiöt.',
    methods: ['Perhokalastus', 'Uistelu', 'Heittokalastus'],
    tip: 'Nousulohi liikkuu vedenkorkeuden noustessa. Yöttömän yön hämärätunnit ovat isojen kalojen aikaa.',
    lightPref: { aamu: 1.0, paiva: 0.45, ilta: 1.0, yo: 0.6 },
    windIdeal: [0.5, 6],
    cloudPref: 'pilvinen',
    pressurePref: 'lasku',
    tempIdeal: [6, 18],
  },
  {
    id: 'meritaimen',
    abundance: 0.36,
    name: 'Meritaimen',
    latin: 'Salmo trutta trutta',
    waters: ['meri', 'joki'],
    latRange: [59.5, 66.0],
    activeMonths: [3, 4, 5, 6, 7, 8, 12, 1, 2],
    peakMonths: [4, 5, 10],
    minSizeCm: 60,
    closedMonths: [9, 10, 11],
    closedNote: 'Jokisuissa ja virtavesissä meritaimen on rauhoitettu 1.9.–30.11.',
    methods: ['Heittokalastus', 'Perhokalastus', 'Uistelu'],
    tip: 'Kevään matalat, lämpenevät rantavedet ja rakkolevävyöhykkeet. Tuulen ajama samea vesi rannassa on plussaa.',
    lightPref: { aamu: 1.0, paiva: 0.6, ilta: 0.95, yo: 0.35 },
    windIdeal: [2, 8],
    cloudPref: 'pilvinen',
    pressurePref: 'lasku',
    tempIdeal: [1, 14],
  },
  {
    id: 'silakka',
    abundance: 0.9,
    name: 'Silakka',
    latin: 'Clupea harengus membras',
    waters: ['meri'],
    latRange: [59.5, 66.0],
    activeMonths: ALL_MONTHS,
    peakMonths: [1, 2, 3, 11, 12],
    methods: ['Litka', 'Silakkakoukut'],
    tip: 'Laiturit, satamat ja väylien reunat. Talvella parvet ovat syvällä, ja litkaus onnistuu myös pimeällä valon avulla.',
    lightPref: { aamu: 0.8, paiva: 0.6, ilta: 0.9, yo: 0.7 },
    windIdeal: [0, 6],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [-5, 14],
  },
  {
    id: 'kampela',
    abundance: 0.58,
    name: 'Kampela',
    latin: 'Platichthys flesus',
    waters: ['meri'],
    latRange: [59.5, 63.5],
    activeMonths: [5, 6, 7, 8, 9, 10],
    peakMonths: [7, 8, 9],
    methods: ['Pohjaonki katkaravulla', 'Mato-onki'],
    tip: 'Hiekka- ja sorapohjat 2–10 metrissä. Kampela löytää syötin hajun perusteella myös sameassa vedessä.',
    lightPref: { aamu: 0.8, paiva: 0.7, ilta: 0.9, yo: 0.5 },
    windIdeal: [0, 6],
    cloudPref: 'vaihteleva',
    pressurePref: 'vakaa',
    tempIdeal: [8, 22],
  },
];

/** Neutral profile used when the user has not picked a target species. */
export const GENERIC_PROFILE = {
  id: 'yleinen',
  name: 'Yleinen kalaonni',
  lightPref: { aamu: 0.95, paiva: 0.55, ilta: 0.95, yo: 0.4 },
  windIdeal: [1.5, 6],
  cloudPref: 'vaihteleva',
  pressurePref: 'vakaa',
  tempIdeal: [6, 22],
};

export const getSpecies = (id) => SPECIES.find((s) => s.id === id) || null;

/**
 * Rank species for a water type, latitude and month.
 * Likelihood combines how widespread the species is with how well the habitat,
 * latitude and month fit. Returns entries sorted by likelihood.
 */
export function matchSpecies({ waterType = 'tuntematon', lat = 62, month = new Date().getMonth() + 1 } = {}) {
  const results = [];
  const vague = waterType === 'tuntematon' || waterType === 'kalapaikka';

  for (const species of SPECIES) {
    const habitatMatch = species.waters.includes(waterType);
    // An unclassified water body cannot rule anything out, so keep every
    // species that fits the latitude and only trim the confidence.
    if (!habitatMatch && !vague) continue;
    // A water body we could not classify is almost never open sea, so keep
    // sea-only species out of the vague case instead of guessing.
    const seaOnly = species.waters.every((w) => w === 'meri');
    if (vague && seaOnly) continue;

    const [minLat, maxLat] = species.latRange;
    const inLatRange = lat >= minLat && lat <= maxLat;
    if (!inLatRange && (lat < minLat - 1.5 || lat > maxLat + 1.5)) continue;

    const inSeason = species.activeMonths.includes(month);
    const isPeak = species.peakMonths.includes(month);
    const isClosed = Array.isArray(species.closedMonths) && species.closedMonths.includes(month);

    const habitatFactor = habitatMatch ? 1 : 0.55;
    const latFactor = inLatRange ? 1 : 0.55;
    const seasonFactor = isPeak ? 1 : inSeason ? 0.7 : 0.28;
    const legalFactor = isClosed ? 0.5 : 1;

    const likelihood = Math.max(
      4,
      Math.min(97, Math.round(100 * species.abundance * habitatFactor * latFactor * seasonFactor * legalFactor)),
    );

    const waterLabel = (WATER_TYPES[waterType] || WATER_TYPES.tuntematon).label.toLowerCase();

    // Say in plain words where the number came from, in the order it was built.
    const reasons = [
      species.abundance >= 0.8
        ? { label: 'Yleisyys', detail: 'hyvin yleinen laji Suomessa', good: true }
        : species.abundance >= 0.5
          ? { label: 'Yleisyys', detail: 'kohtalaisen yleinen laji', good: true }
          : { label: 'Yleisyys', detail: 'harvalukuisempi laji', good: false },
      vague
        ? { label: 'Vesityyppi', detail: 'ei tiedossa – arvio on varovainen', good: false }
        : habitatMatch
          ? { label: 'Vesityyppi', detail: `${waterLabel} sopii lajille`, good: true }
          : { label: 'Vesityyppi', detail: `${waterLabel} ei ole lajin tyypillinen vesi`, good: false },
      inLatRange
        ? { label: 'Levinneisyys', detail: 'esiintyy tällä leveysasteella', good: true }
        : { label: 'Levinneisyys', detail: 'levinneisyysalueen reunalla', good: false },
      isPeak
        ? { label: 'Vuodenaika', detail: 'tämä kuukausi on lajin parasta aikaa', good: true }
        : inSeason
          ? { label: 'Vuodenaika', detail: 'laji on kaudessa', good: true }
          : { label: 'Vuodenaika', detail: 'hiljaista aikaa vuodesta', good: false },
    ];
    if (isClosed) {
      reasons.push({ label: 'Rauhoitus', detail: 'laji on nyt rauhoitettu', good: false });
    }

    results.push({
      ...species,
      likelihood,
      habitatMatch,
      habitatKnown: !vague,
      inSeason,
      isPeak,
      isClosed,
      reasons,
      seasonLabel: isClosed ? 'Rauhoitusaika' : isPeak ? 'Parasta aikaa' : inSeason ? 'Kaudessa' : 'Hiljaista aikaa',
    });
  }

  return results.sort((a, b) => b.likelihood - a.likelihood);
}
