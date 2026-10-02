/** Safe JSON localStorage helpers (ignore quota / private mode). */

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

function browserLocalStorage(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** Parse JSON from a store. Corrupt JSON returns null and never throws. */
export function readJsonFrom(store: KeyValueStore, key: string): unknown {
  try {
    const raw = store.getItem(key)
    if (raw == null) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function writeJsonTo(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode */
  }
}

export function removeKeyFrom(store: KeyValueStore, key: string): void {
  try {
    store.removeItem?.(key)
  } catch {
    /* ignore */
  }
}

export function readJson<T>(key: string): T | null {
  const store = browserLocalStorage()
  if (!store) return null
  const parsed = readJsonFrom(store, key)
  return parsed as T | null
}

export function writeJson(key: string, value: unknown): void {
  const store = browserLocalStorage()
  if (!store) return
  writeJsonTo(store, key, value)
}
