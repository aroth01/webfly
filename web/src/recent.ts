const KEY = 'webfly.recent';
const MAX = 6;

/** localStorage can be missing or throw (private mode, blocked data); every access is guarded. */
function storage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadRecent(store = storage()): string[] {
  try {
    const raw = store?.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function addRecent(query: string, store = storage()): string[] {
  const q = query.trim().toUpperCase();
  const next = [q, ...loadRecent(store).filter((x) => x !== q)].slice(0, MAX);
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* unavailable: recents just don't persist */
  }
  return next;
}
