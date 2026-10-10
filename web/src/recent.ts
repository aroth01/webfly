const KEY = 'webfly.recent';
const MAX = 8;

/** Recent searches on this device. Storage can be missing or throw (private mode); then there are none. */
export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecent(query: string): string[] {
  const list = [query, ...loadRecent().filter((q) => q !== query)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not persisted; the search still works.
  }
  return list;
}
