/**
 * Selected-period return for one snapshot member.
 *
 * Lookback is measured in completed daily bars before the session that
 * produced `price` (see `placePriceSession`):
 * - 1W = 5 sessions, 1M = 21, 3M = 63, 6M = 126
 * - 1D is not a bar offset. It is `price / prevClose - 1`, where `prevClose`
 *   is `resolvePrevClose` (quote previous close when it agrees with the bars,
 *   otherwise the prior session close).
 *
 * Finviz's own windows are Perf Week, Perf Month (their 4-week column),
 * Perf Quart (13-week) and Perf Half (26-week). 4 / 13 / 26 weeks are about
 * 20 / 65 / 130 sessions, so these figures can differ by a few points.
 * Null when the input is not a positive price or there are not enough bars.
 */
import type { GroupPeriod } from '../types/index.ts'
import {
  closeSessionsBeforePrice,
  placePriceSession,
  type PriceClock,
  type PrevCloseBar,
} from './prevClose.ts'

export const PERIOD_SESSIONS: Record<GroupPeriod, number> = {
  '1d': 1,
  '1w': 5,
  '1m': 21,
  '3m': 63,
  '6m': 126,
}

export const LEADER_POOL_SIZE = 20
const AVG_VOLUME_WINDOW = 63
const AVG_VOLUME_MIN_BARS = 5
const REL_VOLUME_WINDOW = 20

export interface PerfBar extends PrevCloseBar {
  v?: number
}

export interface MemberPerfInput {
  bars: PerfBar[]
  price: number
  /** Prior-session close from `resolvePrevClose`. Used only for 1D. */
  prevClose: number | null
  regularMarketTime?: number | null
  gmtoffset?: number | null
  exchangeTimezoneName?: string | null
}

export function round2(n: number): number {
  const rounded = Math.round(n * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

function clockOf(input: MemberPerfInput): PriceClock {
  return {
    regularMarketTime: input.regularMarketTime,
    gmtoffset: input.gmtoffset,
    exchangeTimezoneName: input.exchangeTimezoneName,
  }
}

export function memberPeriodReturnPct(input: MemberPerfInput, period: GroupPeriod): number | null {
  if (!(input.price > 0) || !Number.isFinite(input.price)) return null
  if (period === '1d') {
    if (input.prevClose == null || !(input.prevClose > 0) || !Number.isFinite(input.prevClose)) {
      return null
    }
    return round2((input.price / input.prevClose - 1) * 100)
  }
  const base = closeSessionsBeforePrice(
    input.bars,
    input.price,
    PERIOD_SESSIONS[period],
    clockOf(input),
  )
  if (base == null || !(base > 0)) return null
  return round2((input.price / base - 1) * 100)
}

/** Mean share volume of up to 63 most recent daily bars. Null below 5 bars. */
export function averageShareVolume(input: MemberPerfInput): number | null {
  const placed = placePriceSession(input.bars, input.price, clockOf(input))
  if (!placed) return null
  const last = Math.min(placed.priceIndex, placed.series.length - 1)
  if (last < 0) return null
  const start = Math.max(0, last - (AVG_VOLUME_WINDOW - 1))
  const vols: number[] = []
  for (let i = start; i <= last; i++) {
    const volume = placed.series[i]!.v
    if (typeof volume === 'number' && Number.isFinite(volume) && volume >= 0) vols.push(volume)
  }
  if (vols.length < AVG_VOLUME_MIN_BARS) return null
  return Math.round(vols.reduce((sum, volume) => sum + volume, 0) / vols.length)
}

/**
 * Price-session volume / mean of the 20 completed bars before that session.
 * Null when today's bar is not in the series or the window is short.
 * The session bar is not time-adjusted, so an intraday print is lower than
 * Finviz's relative volume.
 */
export function relativeVolume(input: MemberPerfInput): number | null {
  const placed = placePriceSession(input.bars, input.price, clockOf(input))
  if (!placed) return null
  if (placed.priceIndex < REL_VOLUME_WINDOW || placed.priceIndex >= placed.series.length) return null
  const current = placed.series[placed.priceIndex]!.v
  if (typeof current !== 'number' || !Number.isFinite(current) || current < 0) return null
  const start = placed.priceIndex - REL_VOLUME_WINDOW
  let sum = 0
  for (let i = start; i < placed.priceIndex; i++) {
    const volume = placed.series[i]!.v
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) return null
    sum += volume
  }
  const avg = sum / REL_VOLUME_WINDOW
  if (!(avg > 0)) return null
  return round2(current / avg)
}

export interface RankableMember {
  ticker: string
  perf: number | null
}

function perfValue(perf: number | null): number | null {
  return typeof perf === 'number' && Number.isFinite(perf) ? perf : null
}

/** Higher performance first. Nulls last. Ties break by ticker ascending. */
export function compareMembersByPerf(a: RankableMember, b: RankableMember): number {
  const av = perfValue(a.perf)
  const bv = perfValue(b.perf)
  if (av == null && bv == null) return a.ticker.localeCompare(b.ticker)
  if (av == null) return 1
  if (bv == null) return -1
  if (av !== bv) return bv - av
  return a.ticker.localeCompare(b.ticker)
}

export function rankLeaderPool<T extends RankableMember>(
  rows: T[],
  limit = LEADER_POOL_SIZE,
): T[] {
  return [...rows].sort(compareMembersByPerf).slice(0, Math.max(0, limit))
}
