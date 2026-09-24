/**
 * Versioned list storage on top of localStorage.
 *
 * This is where the user's own data lives – their places and their catches –
 * so it is treated differently from the API caches: it is never pruned, a
 * corrupt entry degrades to an empty list instead of throwing, and a failed
 * write is reported to the caller so the UI can say so.
 */

const VERSION = 'v1';
const key = (name) => `kalaonni:${name}:${VERSION}`;

/** Read a list. Anything unreadable comes back as an empty list. */
export function readList(name) {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * Write a list.
 * @returns {boolean} false when storage refused it (private mode, quota).
 */
export function writeList(name, list) {
  try {
    localStorage.setItem(key(name), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** A stable id that does not need a crypto API to be unique enough here. */
export function makeId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${Date.now().toString(36)}${random}`;
}

/** Everything the user has stored, for a backup file. */
export function exportAll(names) {
  return {
    sovellus: 'kala-onni',
    versio: VERSION,
    vietyAt: new Date().toISOString(),
    ...Object.fromEntries(names.map((name) => [name, readList(name)])),
  };
}

/**
 * Merge a backup back in. Entries already present (same id) are kept as they
 * are, so importing the same file twice does not duplicate anything.
 * @returns {{added: Record<string, number>, ok: boolean}}
 */
export function importAll(data, names) {
  const added = {};
  let ok = true;

  for (const name of names) {
    const incoming = Array.isArray(data?.[name]) ? data[name] : [];
    const existing = readList(name);
    const known = new Set(existing.map((entry) => entry.id));
    const fresh = incoming.filter((entry) => entry?.id && !known.has(entry.id));
    added[name] = fresh.length;
    if (fresh.length && !writeList(name, [...fresh, ...existing])) ok = false;
  }

  return { added, ok };
}
