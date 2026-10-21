/**
 * Performance windows from ascending daily bars, Finviz-style session counts:
 * week 5, month 21, 3M 63, 6M 126, year 252 sessions. YTD is measured from the
 * last close of the previous calendar year (America/New_York date).
 * All values are percent (1.5 = +1.5%), null when there are not enough bars.
 */

export interface PerfBar {
  /** Unix seconds. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface PerfRow {
  price: number
  prevClose: number
  changeFromOpen: number | null
  perfDay: number | null
  perfWeek: number | null
  perfMonth: number | null
  perf3m: number | null
  perf6m: number | null
  perfYtd: number | null
  perfYear: number | null
}

export const PERF_SESSIONS = { week: 5, month: 21, quarter: 63, half: 126, year: 252 } as const

export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return (to / from - 1) * 100
}

/** Close `sessions` bars before the last bar, or null. */
export function closeSessionsAgo(bars: readonly PerfBar[], sessions: number): number | null {
  const idx = bars.length - 1 - sessions
  if (idx < 0) return null
  return bars[idx]!.c
}

const ET_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' })

export function etYear(unixSec: number): number {
  return Number(ET_YEAR.format(new Date(unixSec * 1000)))
}

/** Last close dated in a year before the last bar's year; null if bars start inside that year. */
export function ytdBaseClose(bars: readonly PerfBar[]): number | null {
  if (!bars.length) return null
  const year = etYear(bars[bars.length - 1]!.t)
  for (let i = bars.length - 1; i >= 0; i--) {
    if (etYear(bars[i]!.t) < year) return bars[i]!.c
  }
  return null
}

/**
 * `price` is the live price (last trade); the last bar is the current or most
 * recent session. Window bases are measured back from that last bar.
 */
export function computePerfRow(bars: readonly PerfBar[], price: number, prevClose: number): PerfRow {
  const last = bars[bars.length - 1]
  return {
    price,
    prevClose,
    changeFromOpen: pctChange(last?.o, price),
    perfDay: pctChange(prevClose, price),
    perfWeek: pctChange(closeSessionsAgo(bars, PERF_SESSIONS.week), price),
    perfMonth: pctChange(closeSessionsAgo(bars, PERF_SESSIONS.month), price),
    perf3m: pctChange(closeSessionsAgo(bars, PERF_SESSIONS.quarter), price),
    perf6m: pctChange(closeSessionsAgo(bars, PERF_SESSIONS.half), price),
    perfYtd: pctChange(ytdBaseClose(bars), price),
    perfYear: pctChange(closeSessionsAgo(bars, PERF_SESSIONS.year), price),
  }
}

/** Sort helper: nulls always last regardless of direction. */
export function compareNullable(a: number | null | undefined, b: number | null | undefined, dir: 'asc' | 'desc'): number {
  const an = a == null || !Number.isFinite(a)
  const bn = b == null || !Number.isFinite(b)
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  return dir === 'asc' ? a - b : b - a
}

/**
 * Top gainers / losers with a dollar-volume floor (price × average volume) so
 * illiquid names cannot dominate the tape.
 */
export interface MoverInput {
  ticker: string
  price: number
  changePct: number
  avgVolume: number
}

export const MOVER_MIN_DOLLAR_VOLUME = 20_000_000

export function pickMovers(
  rows: readonly MoverInput[],
  count = 10,
  minDollarVolume = MOVER_MIN_DOLLAR_VOLUME,
): { gainers: MoverInput[]; losers: MoverInput[] } {
  const liquid = rows.filter(
    (r) =>
      Number.isFinite(r.changePct) &&
      r.price > 0 &&
      r.avgVolume > 0 &&
      r.price * r.avgVolume >= minDollarVolume,
  )
  const gainers = liquid.filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, count)
  const losers = liquid.filter((r) => r.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, count)
  return { gainers, losers }
}
