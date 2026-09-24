/**
 * Spot categories: the colour and icon a spot gets on the map, and the
 * filters the user can switch on and off.
 *
 * Colour carries the family, the icon carries the exact type. Only three
 * categorical hues survive a colour-vision check as map markers in both
 * themes, so "meri" shares the water hue at a different step and every
 * category is also told apart by its icon and its label – colour never
 * carries the meaning alone.
 *
 * The categories are mutually exclusive and tested in order: a marked fishing
 * spot stays a marked fishing spot even when it sits on a lake.
 */

export const SPOT_CATEGORIES = [
  {
    id: 'oma',
    label: 'Omat paikat',
    short: 'Omat',
    icon: '⭐',
    description: 'Itse tallentamasi paikat – ne näkyvät vain tällä laitteella',
  },
  {
    id: 'merkitty',
    label: 'Kalapaikat ja laiturit',
    short: 'Kalapaikat',
    icon: '🎣',
    description: 'OpenStreetMapiin merkityt kalastuspaikat, laiturit ja veneluiskat',
  },
  {
    id: 'jarvi',
    label: 'Järvet ja lammet',
    short: 'Järvet',
    icon: '🏞️',
    waterTypes: ['jarvi', 'lampi', 'tekojarvi'],
  },
  {
    id: 'joki',
    label: 'Joet ja kosket',
    short: 'Joet',
    icon: '🌊',
    waterTypes: ['joki', 'puro', 'kanava'],
  },
  {
    id: 'meri',
    label: 'Meri ja rannikko',
    short: 'Meri',
    icon: '⚓',
    waterTypes: ['meri'],
  },
  {
    id: 'muu',
    label: 'Muut vesialueet',
    short: 'Muut',
    icon: '💧',
    waterTypes: ['tuntematon', 'kalapaikka'],
  },
];

const BY_ID = new Map(SPOT_CATEGORIES.map((category) => [category.id, category]));

export const categoryById = (id) => BY_ID.get(id) || BY_ID.get('muu');

/** Which category a spot belongs to. */
export function categoryFor(spot) {
  if (!spot) return categoryById('muu');
  if (spot.isOwnPlace) return categoryById('oma');
  if (spot.isFishingSpot || spot.facilities?.some((f) => f === 'Laituri' || f === 'Veneluiska')) {
    return categoryById('merkitty');
  }
  const match = SPOT_CATEGORIES.find((category) => category.waterTypes?.includes(spot.waterType));
  return match || categoryById('muu');
}

/** How many spots fall into each category, for the filter chips. */
export function countByCategory(spots) {
  const counts = Object.fromEntries(SPOT_CATEGORIES.map((category) => [category.id, 0]));
  for (const spot of spots) counts[categoryFor(spot).id] += 1;
  return counts;
}
