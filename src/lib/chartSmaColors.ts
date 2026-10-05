/**
 * SMA line colours and visibility for the daily chart, persisted in localStorage.
 *
 * Current key: {@link CHART_SMA_PREFS_KEY} (`qm.chartSmaPrefs.v2`).
 * Shape: `{ colors: SmaColorMap, enabled: { "10", "20", "50", "200", "vol20" booleans } }`.
 * A missing or invalid entry keeps that key's default. Corrupt JSON loads
 * the defaults and never throws.
 *
 * If v2 is absent and {@link CHART_SMA_COLORS_KEY} (`qm.chartSmaColors.v1`) is
 * present, its colours are copied and `enabled` is the code defaults, then v2
 * is written. A present v2 key wins, even when its JSON is corrupt. An older
 * unversioned {@link CHART_SMA_COLORS_V0_KEY} is used the same way when v1 is
 * also absent.
 *
 * {@link loadSmaColors} still reads the v1 colour map (and migrates v0 into v1).
 * The chart loads {@link loadChartSmaPrefs}.
 */
import {
  readJsonFrom,
  removeKeyFrom,
  writeJsonTo,
  type KeyValueStore,
} from './persist'

export const CHART_SMA_PREFS_KEY = 'qm.chartSmaPrefs.v2'
export const CHART_SMA_COLORS_KEY = 'qm.chartSmaColors.v1'
export const CHART_SMA_COLORS_V0_KEY = 'qm.chartSmaColors'

export type SmaColorKey = '10' | '20' | '50' | '200' | 'vol20'
export type SmaColorMap = Record<SmaColorKey, string>
export type SmaEnabledMap = Record<SmaColorKey, boolean>

export interface ChartSmaPrefs {
  colors: SmaColorMap
  enabled: SmaEnabledMap
}

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

/**
 * Code defaults. Price SMA 10 / 20 / 50 / 200 and Vol SMA 20 all start on.
 * A saved v2 `enabled` map overrides this after the user presses Save as default.
 */
export const DEFAULT_SMA_ENABLED: SmaEnabledMap = {
  '10': true,
  '20': true,
  '50': true,
  '200': true,
  vol20: true,
}

export function defaultSmaColors(): SmaColorMap {
  return { ...DEFAULT_SMA_COLORS }
}

export function defaultSmaEnabled(): SmaEnabledMap {
  return { ...DEFAULT_SMA_ENABLED }
}

export function defaultChartSmaPrefs(): ChartSmaPrefs {
  return { colors: defaultSmaColors(), enabled: defaultSmaEnabled() }
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

/** Keep real booleans. Anything else falls back per key. */
export function parseSmaEnabled(raw: unknown): SmaEnabledMap {
  const next = defaultSmaEnabled()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return next
  const obj = raw as Record<string, unknown>
  for (const key of SMA_COLOR_KEYS) {
    const value = obj[key]
    if (typeof value === 'boolean') next[key] = value
  }
  return next
}

/** Invalid colour or enabled entries fall back per key. A bad shape is all defaults. */
export function parseChartSmaPrefs(raw: unknown): ChartSmaPrefs {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return defaultChartSmaPrefs()
  const obj = raw as Record<string, unknown>
  return {
    colors: parseSmaColors(obj.colors),
    enabled: parseSmaEnabled(obj.enabled),
  }
}

function prefsFromColors(colors: SmaColorMap): ChartSmaPrefs {
  return { colors, enabled: defaultSmaEnabled() }
}

/**
 * Load v2 prefs. When v2 is missing, copy v1 colours (or v0 if v1 is missing)
 * and the default toggles into v2. A present v2 key wins, including corrupt JSON.
 */
export function loadChartSmaPrefs(store?: KeyValueStore | null): ChartSmaPrefs {
  const kv = resolveStore(store)
  if (!kv) return defaultChartSmaPrefs()
  if (kv.getItem(CHART_SMA_PREFS_KEY) != null) {
    return parseChartSmaPrefs(readJsonFrom(kv, CHART_SMA_PREFS_KEY))
  }
  const legacyKey =
    kv.getItem(CHART_SMA_COLORS_KEY) != null
      ? CHART_SMA_COLORS_KEY
      : kv.getItem(CHART_SMA_COLORS_V0_KEY) != null
        ? CHART_SMA_COLORS_V0_KEY
        : null
  if (legacyKey == null) return defaultChartSmaPrefs()
  const prefs = prefsFromColors(parseSmaColors(readJsonFrom(kv, legacyKey)))
  writeJsonTo(kv, CHART_SMA_PREFS_KEY, prefs)
  return prefs
}

export function saveChartSmaPrefs(prefs: ChartSmaPrefs, store?: KeyValueStore | null): void {
  const kv = resolveStore(store)
  if (!kv) return
  writeJsonTo(kv, CHART_SMA_PREFS_KEY, parseChartSmaPrefs(prefs))
}
