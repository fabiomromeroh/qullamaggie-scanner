/**
 * Daily bars payload for the full-screen chart.
 * Reuses `fetchSymbolSnapshot` (no extra provider cascade). Cache ~15 min.
 */
import { createSymbolCache } from './ttlCache.ts'

export const BARS_CACHE_TTL_MS = 15 * 60 * 1000
export const MAX_DAILY_BARS = 500

export interface DailyBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface BarsSnapshotLike {
  symbol: string
  name?: string
  provider: string
  price: number
  bars: unknown
}

export interface BarsPayload {
  symbol: string
  name?: string
  provider: string
  asOf: string
  bars: DailyBar[]
  price: number
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Drop nulls/NaN, sort ascending by t, keep at most the last `max` bars. */
export function shapeDailyBars(bars: unknown, max = MAX_DAILY_BARS): DailyBar[] {
  if (!Array.isArray(bars)) return []
  const out: DailyBar[] = []
  for (const raw of bars) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const t = finiteNumber(row.t)
    const o = finiteNumber(row.o)
    const h = finiteNumber(row.h)
    const l = finiteNumber(row.l)
    const c = finiteNumber(row.c)
    if (t == null || t <= 0 || o == null || h == null || l == null || c == null) continue
    const v = finiteNumber(row.v)
    out.push({ t, o, h, l, c, v: v == null || v < 0 ? 0 : v })
  }
  out.sort((a, b) => a.t - b.t)
  return out.length > max ? out.slice(-max) : out
}

export function buildBarsPayload(
  snap: BarsSnapshotLike,
  asOf: () => string = () => new Date().toISOString(),
): BarsPayload {
  const bars = shapeDailyBars(snap.bars)
  const payload: BarsPayload = {
    symbol: snap.symbol,
    provider: snap.provider,
    asOf: asOf(),
    bars,
    price: snap.price,
  }
  if (snap.name) payload.name = snap.name
  return payload
}

const barsCache = createSymbolCache<BarsPayload>({ ttlMs: BARS_CACHE_TTL_MS })

export type SnapshotLoader = (symbol: string) => Promise<BarsSnapshotLike>

export async function getBarsForSymbol(
  symbol: string,
  loadSnapshot: SnapshotLoader,
): Promise<BarsPayload> {
  return barsCache.get(symbol, async () => {
    const snap = await loadSnapshot(symbol)
    const payload = buildBarsPayload({ ...snap, symbol })
    if (!payload.bars.length) {
      throw new Error(`No daily bars for ${symbol}`)
    }
    return payload
  })
}

export function clearBarsCache(): void {
  barsCache.clear()
}
