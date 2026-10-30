/**
 * Shared client-side liquidity toggles (Price > $5, Avg vol > 100K, $Vol > $20M).
 * Default all ON. Persist in localStorage. Unknown values are kept — never guessed.
 * Scanner Stage 1 / Finviz membership still use a looser universe size floor;
 * these rules live only in the UI.
 */
import { useSyncExternalStore } from 'react'
import {
  readJsonFrom,
  writeJsonTo,
  type KeyValueStore,
} from './persist'

export const LIQUIDITY_FILTERS_KEY = 'qm.liquidityFilters.v1'

/** UI price toggle: keep a finite price strictly above this. */
export const LIQUIDITY_PRICE_FLOOR = 5
/** UI 20-day average share-volume toggle: keep a finite value strictly above this. */
export const LIQUIDITY_AVG_VOL_FLOOR = 100_000
/**
 * UI 20-day average dollar-volume toggle: keep a finite value at or above this.
 * Inclusive so a name printing exactly $20M still passes (same as the old
 * request-time member cut). Scanner Min DolVol (default $30M) is independent;
 * when both are on, the stricter (higher) floor wins.
 */
export const LIQUIDITY_DOLLAR_VOL_FLOOR = 20_000_000

export interface LiquidityFilters {
  priceGt5: boolean
  avgVol100k: boolean
  dollarVol20m: boolean
}

export const DEFAULT_LIQUIDITY_FILTERS: LiquidityFilters = {
  priceGt5: true,
  avgVol100k: true,
  dollarVol20m: true,
}

export interface LiquidityRow {
  price?: number | null
  avgVolume?: number | null
  dollarVolume20?: number | null
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 20-day average shares from 20-day dollar volume ÷ price.
 * Null when either input is unknown or price is not positive — never invented.
 */
export function deriveAvgVolume(
  price: number | null | undefined,
  dollarVolume20: number | null | undefined,
): number | null {
  const p = finiteNumber(price)
  const d = finiteNumber(dollarVolume20)
  if (p == null || d == null || !(p > 0)) return null
  return d / p
}

/** Map a scan idea (or similar) onto the liquidity predicate fields. */
export function liquidityRowFromIdea(idea: {
  price?: number | null
  avgVolume?: number | null
  avgDollarVol?: number | null
  dollarVolume?: number | null
}): LiquidityRow {
  const price = finiteNumber(idea.price)
  const dollarVolume20 = finiteNumber(idea.avgDollarVol ?? idea.dollarVolume)
  const avgVolume = finiteNumber(idea.avgVolume) ?? deriveAvgVolume(price, dollarVolume20)
  return { price, avgVolume, dollarVolume20 }
}

export function cloneLiquidityFilters(filters: LiquidityFilters): LiquidityFilters {
  return {
    priceGt5: Boolean(filters.priceGt5),
    avgVol100k: Boolean(filters.avgVol100k),
    dollarVol20m: Boolean(filters.dollarVol20m),
  }
}

export function parseLiquidityFilters(raw: unknown): LiquidityFilters {
  const base = cloneLiquidityFilters(DEFAULT_LIQUIDITY_FILTERS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const src = raw as Record<string, unknown>
  return {
    priceGt5: typeof src.priceGt5 === 'boolean' ? src.priceGt5 : base.priceGt5,
    avgVol100k: typeof src.avgVol100k === 'boolean' ? src.avgVol100k : base.avgVol100k,
    dollarVol20m: typeof src.dollarVol20m === 'boolean' ? src.dollarVol20m : base.dollarVol20m,
  }
}

function browserStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function resolveStore(store?: KeyValueStore | null): KeyValueStore | null {
  if (store !== undefined) return store
  return browserStore()
}

export function loadLiquidityFilters(store?: KeyValueStore | null): LiquidityFilters {
  const kv = resolveStore(store)
  if (!kv) return cloneLiquidityFilters(DEFAULT_LIQUIDITY_FILTERS)
  return parseLiquidityFilters(readJsonFrom(kv, LIQUIDITY_FILTERS_KEY))
}

export function saveLiquidityFilters(filters: LiquidityFilters, store?: KeyValueStore | null): void {
  const kv = resolveStore(store)
  if (!kv) return
  writeJsonTo(kv, LIQUIDITY_FILTERS_KEY, cloneLiquidityFilters(filters))
}

/**
 * Unknown (null / missing / non-finite) values always pass — they are marked
 * in the UI, never filled in. A known value fails only the toggles that are on.
 */
export function passesLiquidityFilters(row: LiquidityRow, filters: LiquidityFilters): boolean {
  if (filters.priceGt5) {
    const price = finiteNumber(row.price)
    if (price != null && !(price > LIQUIDITY_PRICE_FLOOR)) return false
  }
  if (filters.avgVol100k) {
    const vol = finiteNumber(row.avgVolume)
    if (vol != null && !(vol > LIQUIDITY_AVG_VOL_FLOOR)) return false
  }
  if (filters.dollarVol20m) {
    const dol = finiteNumber(row.dollarVolume20)
    if (dol != null && dol < LIQUIDITY_DOLLAR_VOL_FLOOR) return false
  }
  return true
}

export function liquidityFilterLabels(filters: LiquidityFilters): string[] {
  const labels: string[] = []
  if (filters.priceGt5) labels.push('Price > $5')
  if (filters.avgVol100k) labels.push('Avg vol > 100K')
  if (filters.dollarVol20m) labels.push('$Vol > $20M')
  return labels
}

const listeners = new Set<() => void>()
let cached: LiquidityFilters | null = null
let initialized = false

function currentFilters(): LiquidityFilters {
  if (!initialized) {
    initialized = true
    cached = loadLiquidityFilters()
  }
  return cached ?? cloneLiquidityFilters(DEFAULT_LIQUIDITY_FILTERS)
}

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getLiquidityFilters(): LiquidityFilters {
  return currentFilters()
}

export function setLiquidityFilters(next: LiquidityFilters): void {
  cached = cloneLiquidityFilters(next)
  initialized = true
  saveLiquidityFilters(cached)
  emit()
}

export function resetLiquidityFilters(): void {
  setLiquidityFilters(cloneLiquidityFilters(DEFAULT_LIQUIDITY_FILTERS))
}

export function useLiquidityFilters(): {
  filters: LiquidityFilters
  setFilters: (next: LiquidityFilters) => void
  reset: () => void
} {
  const filters = useSyncExternalStore(subscribe, getLiquidityFilters, () => DEFAULT_LIQUIDITY_FILTERS)
  return { filters, setFilters: setLiquidityFilters, reset: resetLiquidityFilters }
}
