/**
 * SMA line colours for the daily chart, persisted in localStorage.
 *
 * Key: {@link CHART_SMA_COLORS_KEY} (`qm.chartSmaColors.v1`).
 * Shape: `{ "10", "20", "50", "200", "vol20" }` → `#rrggbb`.
 * A missing or invalid entry keeps that key's default. Corrupt JSON loads
 * the defaults and never throws.
 *
 * An older unversioned key {@link CHART_SMA_COLORS_V0_KEY} is copied into v1
 * once and then removed. A present v1 key wins, even when its JSON is corrupt.
 */
import {
  readJsonFrom,
  removeKeyFrom,
  writeJsonTo,
  type KeyValueStore,
} from './persist'

export const CHART_SMA_COLORS_KEY = 'qm.chartSmaColors.v1'
export const CHART_SMA_COLORS_V0_KEY = 'qm.chartSmaColors'

export type SmaColorKey = '10' | '20' | '50' | '200' | 'vol20'
export type SmaColorMap = Record<SmaColorKey, string>

/**
 * Price SMA defaults match the original chart chips.
 * `vol20` is `#38bdf8`, distinct from price SMA 20 (`#59c2ff`).
 */
export const DEFAULT_SMA_COLORS: SmaColorMap = {
  '10': '#c792ea',
  '20': '#59c2ff',
  '50': '#ffcc66',
  '200': '#e6edf3',
  vol20: '#38bdf8',
}

const SMA_COLOR_KEYS: readonly SmaColorKey[] = ['10', '20', '50', '200', 'vol20']
const HEX6 = /^#[0-9a-fA-F]{6}$/

export function defaultSmaColors(): SmaColorMap {
  return { ...DEFAULT_SMA_COLORS }
}

/** Keep valid `#rrggbb` entries (any case). Anything else falls back per key. */
export function parseSmaColors(raw: unknown): SmaColorMap {
  const next = defaultSmaColors()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return next
  const obj = raw as Record<string, unknown>
  for (const key of SMA_COLOR_KEYS) {
    const value = obj[key]
    if (typeof value === 'string' && HEX6.test(value)) next[key] = value.toLowerCase()
  }
  return next
}

function resolveStore(store?: KeyValueStore | null): KeyValueStore | null {
  if (store !== undefined) return store
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function loadSmaColors(store?: KeyValueStore | null): SmaColorMap {
  const kv = resolveStore(store)
  if (!kv) return defaultSmaColors()
  if (kv.getItem(CHART_SMA_COLORS_KEY) != null) {
    return parseSmaColors(readJsonFrom(kv, CHART_SMA_COLORS_KEY))
  }
  if (kv.getItem(CHART_SMA_COLORS_V0_KEY) == null) return defaultSmaColors()
  const migrated = parseSmaColors(readJsonFrom(kv, CHART_SMA_COLORS_V0_KEY))
  writeJsonTo(kv, CHART_SMA_COLORS_KEY, migrated)
  removeKeyFrom(kv, CHART_SMA_COLORS_V0_KEY)
  return migrated
}

export function saveSmaColors(colors: SmaColorMap, store?: KeyValueStore | null): void {
  const kv = resolveStore(store)
  if (!kv) return
  writeJsonTo(kv, CHART_SMA_COLORS_KEY, parseSmaColors(colors))
}
