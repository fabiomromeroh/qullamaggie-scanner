/**
 * Stockbee-style Market Monitor breadth, computed from daily bars.
 *
 * Definitions (all per stock, per session `i`, using closes unless noted):
 *  - Eligible: close ≥ $5 and 20-session average dollar volume (close × volume) ≥ $5M,
 *    with at least 21 prior bars. Only eligible stocks count toward any column that day.
 *  - Up 4% today: close ≥ +4% vs prior close AND volume > prior volume (Stockbee 4% breakout).
 *    Down 4%: close ≤ −4% AND volume > prior volume.
 *  - 5 / 10 day ratio: Σ up-4% counts ÷ Σ down-4% counts over the last 5 / 10 sessions.
 *  - Up / down 25%+ quarter: close vs close 65 sessions earlier ≥ +25% / ≤ −25%.
 *  - Up / down 25%+ month: same vs 21 sessions; 50%+ month: ±50% vs 21 sessions.
 *  - Up / down 13%+ in 34 days: ±13% vs 34 sessions.
 *  - 10x ATR ext.: (close − SMA50) ÷ ATR14 ≥ 10 (Wilder-free simple mean of true range).
 *  - >50dma / >200dma: % of eligible stocks with close above the 50 / 200 SMA
 *    (denominator: eligible stocks that have that many bars).
 *  - Advancing / declining: close above / below prior close.
 *  - New 52w high / low: today's high ≥ max high of the prior 252 sessions /
 *    today's low ≤ min low of the prior 252 sessions (needs 252 prior bars).
 */

export interface BreadthBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export const BREADTH_RULES = {
  minPrice: 5,
  minDollarVolume20: 5_000_000,
  movePct: 4,
  quarterSessions: 65,
  monthSessions: 21,
  daysSessions34: 34,
  quarterPct: 25,
  monthPct: 25,
  month50Pct: 50,
  days34Pct: 13,
  atrPeriod: 14,
  atrExtMultiple: 10,
  highLowSessions: 252,
} as const

export interface DayCounts {
  date: string
  universe: number
  up4: number
  down4: number
  up25q: number
  down25q: number
  up25m: number
  down25m: number
  up50m: number
  down50m: number
  up13x34: number
  down13x34: number
  atrExt10: number
  above50: number
  base50: number
  above200: number
  base200: number
  advancing: number
  declining: number
  newHighs: number
  newLows: number
  baseHighLow: number
}

export interface BreadthRow extends DayCounts {
  ratio5: number | null
  ratio10: number | null
  pctAbove50: number | null
  pctAbove200: number | null
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function etDate(unixSec: number): string {
  return ET_DATE.format(new Date(unixSec * 1000))
}

export function emptyCounts(date: string): DayCounts {
  return {
    date,
    universe: 0,
    up4: 0,
    down4: 0,
    up25q: 0,
    down25q: 0,
    up25m: 0,
    down25m: 0,
    up50m: 0,
    down50m: 0,
    up13x34: 0,
    down13x34: 0,
    atrExt10: 0,
    above50: 0,
    base50: 0,
    above200: 0,
    base200: 0,
    advancing: 0,
    declining: 0,
    newHighs: 0,
    newLows: 0,
    baseHighLow: 0,
  }
}

function pct(from: number, to: number): number {
  return (to / from - 1) * 100
}

/**
 * Add one stock's contribution to `acc` (date → counts) for its last `days` sessions.
 * Bars must be ascending. Runs in O(bars) with rolling sums.
 */
export function accumulateStock(bars: readonly BreadthBar[], days: number, acc: Map<string, DayCounts>): void {
  const n = bars.length
  if (n < 22) return
  const R = BREADTH_RULES
  // Prefix sums for SMA / dollar volume / true range.
  const closeSum = new Float64Array(n + 1)
  const dvSum = new Float64Array(n + 1)
  const trSum = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const b = bars[i]!
    closeSum[i + 1] = closeSum[i]! + b.c
    dvSum[i + 1] = dvSum[i]! + b.c * b.v
    const prevC = i > 0 ? bars[i - 1]!.c : b.c
    const tr = Math.max(b.h - b.l, Math.abs(b.h - prevC), Math.abs(b.l - prevC))
    trSum[i + 1] = trSum[i]! + tr
  }
  const avg = (sum: Float64Array, end: number, len: number) => (sum[end + 1]! - sum[end + 1 - len]!) / len

  const start = Math.max(21, n - days)
  for (let i = start; i < n; i++) {
    const b = bars[i]!
    const prev = bars[i - 1]!
    if (!(b.c >= R.minPrice) || !(prev.c > 0)) continue
    if (avg(dvSum, i, 20) < R.minDollarVolume20) continue
    const date = etDate(b.t)
    let row = acc.get(date)
    if (!row) {
      row = emptyCounts(date)
      acc.set(date, row)
    }
    row.universe++
    const day = pct(prev.c, b.c)
    if (b.c > prev.c) row.advancing++
    else if (b.c < prev.c) row.declining++
    if (b.v > prev.v) {
      if (day >= R.movePct) row.up4++
      else if (day <= -R.movePct) row.down4++
    }
    const back = (k: number) => (i - k >= 0 ? bars[i - k]!.c : null)
    const q = back(R.quarterSessions)
    if (q && q > 0) {
      const p = pct(q, b.c)
      if (p >= R.quarterPct) row.up25q++
      else if (p <= -R.quarterPct) row.down25q++
    }
    const m = back(R.monthSessions)
    if (m && m > 0) {
      const p = pct(m, b.c)
      if (p >= R.monthPct) row.up25m++
      else if (p <= -R.monthPct) row.down25m++
      if (p >= R.month50Pct) row.up50m++
      else if (p <= -R.month50Pct) row.down50m++
    }
    const d34 = back(R.daysSessions34)
    if (d34 && d34 > 0) {
      const p = pct(d34, b.c)
      if (p >= R.days34Pct) row.up13x34++
      else if (p <= -R.days34Pct) row.down13x34++
    }
    if (i >= 49) {
      const sma50 = avg(closeSum, i, 50)
      row.base50++
      if (b.c > sma50) row.above50++
      if (i >= R.atrPeriod) {
        const atr = avg(trSum, i, R.atrPeriod)
        if (atr > 0 && (b.c - sma50) / atr >= R.atrExtMultiple) row.atrExt10++
      }
    }
    if (i >= 199) {
      row.base200++
      if (b.c > avg(closeSum, i, 200)) row.above200++
    }
    if (i >= R.highLowSessions) {
      let hi = -Infinity
      let lo = Infinity
      for (let k = i - R.highLowSessions; k < i; k++) {
        const x = bars[k]!
        if (x.h > hi) hi = x.h
        if (x.l < lo) lo = x.l
      }
      row.baseHighLow++
      if (b.h >= hi) row.newHighs++
      if (b.l <= lo) row.newLows++
    }
  }
}

function ratio(num: number, den: number): number | null {
  if (den === 0) return num === 0 ? null : Infinity
  return num / den
}

/** Newest first; ratios use the trailing 5 / 10 rows (null until that many rows exist). */
export function finalizeRows(acc: Map<string, DayCounts>, keep: number, minUniverse = 1): BreadthRow[] {
  const asc = [...acc.values()].filter((r) => r.universe >= minUniverse).sort((a, b) => a.date.localeCompare(b.date))
  const rows: BreadthRow[] = asc.map((r, i) => {
    const win = (k: number) => {
      if (i + 1 < k) return null
      let up = 0
      let down = 0
      for (let j = i - k + 1; j <= i; j++) {
        up += asc[j]!.up4
        down += asc[j]!.down4
      }
      return ratio(up, down)
    }
    return {
      ...r,
      ratio5: win(5),
      ratio10: win(10),
      pctAbove50: r.base50 ? (r.above50 / r.base50) * 100 : null,
      pctAbove200: r.base200 ? (r.above200 / r.base200) * 100 : null,
    }
  })
  return rows.reverse().slice(0, keep)
}

export type Tone = 'strong-green' | 'green' | 'red' | 'strong-red' | 'amber' | null

/** Stockbee's thresholds assume a ~6,000-stock universe; counts are scaled to ours. */
export const STOCKBEE_UNIVERSE = 6000

export function scaledThreshold(base: number, universe: number): number {
  return Math.max(1, Math.round((base * universe) / STOCKBEE_UNIVERSE))
}

export type BreadthColumn =
  | 'up4'
  | 'down4'
  | 'ratio5'
  | 'ratio10'
  | 'up25q'
  | 'down25q'
  | 'up25m'
  | 'down25m'
  | 'up50m'
  | 'down50m'
  | 'up13x34'
  | 'down13x34'
  | 'atrExt10'
  | 'pctAbove50'
  | 'pctAbove200'

/**
 * Heat-map colouring.
 *  - Up 4%: ≥ 300 (scaled) strong green; Down 4%: ≥ 300 (scaled) strong red.
 *    Otherwise the larger of the up/down pair is tinted green/red.
 *  - 5 / 10 day ratio: ≥ 2 green (≥ 3 strong), ≤ 0.5 red (≤ 0.33 strong).
 *  - Quarter 25%: up < down → red row signal (Stockbee: up-25%-quarter below ~200/6000 is a weak tape).
 *    Each up/down pair: larger side tinted; up25q ≤ 200 scaled → red.
 *  - >50dma / >200dma: ≥ 80 strong green, ≥ 60 green, ≤ 40 red, ≤ 20 strong red.
 *  - 10x ATR ext.: ≥ 0.5% of universe → amber (extended tape).
 */
export function cellTone(col: BreadthColumn, row: BreadthRow): Tone {
  const u = row.universe
  const pair = (up: number, down: number, side: 'up' | 'down'): Tone => {
    if (up === down) return null
    if (side === 'up') return up > down ? 'green' : null
    return down > up ? 'red' : null
  }
  switch (col) {
    case 'up4':
      if (row.up4 >= scaledThreshold(300, u)) return 'strong-green'
      return pair(row.up4, row.down4, 'up')
    case 'down4':
      if (row.down4 >= scaledThreshold(300, u)) return 'strong-red'
      return pair(row.up4, row.down4, 'down')
    case 'ratio5':
    case 'ratio10': {
      const r = row[col]
      if (r == null) return null
      if (r >= 3) return 'strong-green'
      if (r >= 2) return 'green'
      if (r <= 1 / 3) return 'strong-red'
      if (r <= 0.5) return 'red'
      return null
    }
    case 'up25q':
      if (row.up25q <= scaledThreshold(200, u)) return 'red'
      return pair(row.up25q, row.down25q, 'up')
    case 'down25q':
      return pair(row.up25q, row.down25q, 'down')
    case 'up25m':
      return pair(row.up25m, row.down25m, 'up')
    case 'down25m':
      return pair(row.up25m, row.down25m, 'down')
    case 'up50m':
      return pair(row.up50m, row.down50m, 'up')
    case 'down50m':
      return pair(row.up50m, row.down50m, 'down')
    case 'up13x34':
      return pair(row.up13x34, row.down13x34, 'up')
    case 'down13x34':
      return pair(row.up13x34, row.down13x34, 'down')
    case 'atrExt10':
      return u > 0 && row.atrExt10 / u >= 0.005 ? 'amber' : null
    case 'pctAbove50':
    case 'pctAbove200': {
      const v = row[col]
      if (v == null) return null
      if (v >= 80) return 'strong-green'
      if (v >= 60) return 'green'
      if (v <= 20) return 'strong-red'
      if (v <= 40) return 'red'
      return null
    }
  }
}
