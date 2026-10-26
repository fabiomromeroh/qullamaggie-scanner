/**
 * Deterministic market-breadth read from Market Monitor rows (newest first).
 * Pure: the same rows always give the same summary. Uses only fields the
 * breadth job computes; anything missing is skipped, never guessed.
 */
import { down4Of, scaledThreshold, up4Of, type BreadthRow } from './breadth'

export type Regime = 'strong' | 'healthy' | 'neutral' | 'weak' | 'washout'

export interface SummarySignal {
  key: string
  label: string
  /** −2 … +2 contribution to the regime score. */
  score: number
  text: string
}

export interface BreadthSummary {
  date: string
  partial: boolean
  asOf: string | null
  regime: Regime
  score: number
  signals: SummarySignal[]
  conclusions: string[]
  /** Raw numbers the read is based on (for the LLM prompt and the UI). */
  facts: Record<string, number | string | null>
}

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)
const r1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)

function trend(now: number | null, before: number | null, eps: number): 'rising' | 'falling' | 'flat' | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return null
  if (now - before > eps) return 'rising'
  if (before - now > eps) return 'falling'
  return 'flat'
}

function balance(up: number, down: number): number {
  return down === 0 ? (up === 0 ? 1 : Infinity) : up / down
}

export function summarizeBreadth(rows: readonly BreadthRow[]): BreadthSummary | null {
  const t = rows[0]
  if (!t) return null
  const back = rows[5] ?? null
  const signals: SummarySignal[] = []
  const add = (key: string, label: string, score: number, text: string) => signals.push({ key, label, score, text })

  // 5D / 10D ratio level and trend.
  const r5 = t.ratio5
  const r10 = t.ratio10
  if (r5 != null) {
    const tr = trend(r5, back?.ratio5 ?? null, 0.15)
    const s = r5 >= 2 ? 2 : r5 >= 1.2 ? 1 : r5 <= 0.5 ? -2 : r5 <= 0.8 ? -1 : 0
    add('ratio5', '5-day ratio', s, `5D ratio ${r2(r5)}${tr ? ` (${tr} vs ${r2(back?.ratio5)} five sessions ago)` : ''}.`)
  }
  if (r10 != null) {
    const tr = trend(r10, back?.ratio10 ?? null, 0.1)
    const s = r10 >= 1.5 ? 1 : r10 <= 0.7 ? -1 : 0
    add('ratio10', '10-day ratio', s, `10D ratio ${r2(r10)}${tr ? ` (${tr})` : ''}.`)
  }

  // 4% thrusts today (Stockbee's 300 scaled to our universe).
  const thrust = scaledThreshold(300, t.universe)
  const up4 = up4Of(t)
  const dn4 = down4Of(t)
  if (up4 >= thrust && up4 > dn4) add('thrust', '4% thrust', 1, `Up-4% thrust: ${up4} stocks up ≥ 4% (threshold ${thrust}), ${dn4} down.`)
  else if (dn4 >= thrust && dn4 > up4) add('thrust', '4% thrust', -1, `Down-4% thrust: ${dn4} stocks down ≥ 4% (threshold ${thrust}), ${up4} up.`)
  else add('thrust', '4% day', 0, `No 4% thrust today: ${up4} up vs ${dn4} down (thrust threshold ${thrust}).`)

  // Quarter 25% and 13%/34 balance.
  const q = balance(t.up25q, t.down25q)
  add('q25', '25% quarter', q >= 1.2 ? 1 : q <= 0.8 ? -1 : 0, `Up 25%+ in a quarter ${t.up25q} vs down ${t.down25q}.`)
  const m34 = balance(t.up13x34, t.down13x34)
  add('m34', '13% / 34 days', m34 >= 1.2 ? 1 : m34 <= 0.6 ? -1 : 0, `Up 13%+ in 34 days ${t.up13x34} vs down ${t.down13x34}.`)

  // Moving-average participation.
  const p50 = t.pctAbove50
  if (p50 != null) {
    const tr = trend(p50, back?.pctAbove50 ?? null, 2)
    const s = p50 >= 60 ? 1 : p50 <= 40 ? -1 : 0
    add('ma50', '> 50dma', s, `${r1(p50)}% above the 50-day${tr ? `, ${tr} from ${r1(back?.pctAbove50)}%` : ''}.`)
  }
  const p200 = t.pctAbove200
  if (p200 != null) {
    const tr = trend(p200, back?.pctAbove200 ?? null, 2)
    add('ma200', '> 200dma', p200 >= 60 ? 1 : p200 <= 40 ? -1 : 0, `${r1(p200)}% above the 200-day${tr ? `, ${tr}` : ''}.`)
  }

  // New highs vs new lows.
  if (t.newHighs + t.newLows > 0) {
    const s = t.newHighs > t.newLows * 1.5 ? 1 : t.newLows > t.newHighs * 1.5 ? -1 : 0
    add('hilo', 'Highs / lows', s, `52-week new highs ${t.newHighs} vs new lows ${t.newLows}.`)
  }

  const score = signals.reduce((a, s) => a + s.score, 0)
  const washout = (p50 != null && p50 <= 20) || (dn4 >= thrust && r10 != null && r10 <= 0.5)
  const regime: Regime = washout ? 'washout' : score >= 5 ? 'strong' : score >= 2 ? 'healthy' : score >= -1 ? 'neutral' : 'weak'

  const conclusions: string[] = []
  switch (regime) {
    case 'strong':
      conclusions.push('Breadth confirms the trend: be aggressive on fresh breakouts and high-tight flags; full position sizes on A and A+ setups.')
      conclusions.push('Let winners run; trail with the 10/20-day MA instead of taking quick profits.')
      break
    case 'healthy':
      conclusions.push('Constructive tape: take A/A+ breakouts from tight bases with normal size; skip extended names.')
      conclusions.push('Add only to positions that are working; keep stops at the day’s low.')
      break
    case 'neutral':
      conclusions.push('Mixed breadth: trade only A+ setups in leading groups, smaller size, and take partial profits faster.')
      conclusions.push('Wait for a 4% up-thrust or a 5D ratio above 2 before pressing.')
      break
    case 'weak':
      conclusions.push('Weak breadth: mostly cash; only the very best A+ setups with reduced size, if any.')
      conclusions.push('Expect breakouts to fail more often; tighten stops and avoid adding.')
      break
    case 'washout':
      conclusions.push('Washout conditions: do not short into it; build a watchlist of leaders holding up best.')
      conclusions.push('Start buying small only after an up-4% thrust day and the 5D ratio turning up.')
      break
  }
  if (p50 != null && p50 >= 80) conclusions.push('Over 80% above the 50-day: extended; expect a pause, avoid chasing.')
  if (t.atrExt10 > 0 && t.atrExt10 >= Math.max(3, Math.round(t.universe * 0.005)))
    conclusions.push(`${t.atrExt10} stocks are 10× ATR above the 50-day: froth; trim extended leaders.`)
  if (t.partial) conclusions.push(`Today's row is intraday (as of ${t.asOf ?? 'unknown'}); counts can still change before the close.`)

  return {
    date: t.date,
    partial: Boolean(t.partial),
    asOf: t.asOf ?? null,
    regime,
    score,
    signals,
    conclusions,
    facts: {
      date: t.date,
      universe: t.universe,
      up4,
      down4: dn4,
      thrustThreshold: thrust,
      ratio5: r2(r5),
      ratio10: r2(r10),
      ratio5FiveSessionsAgo: r2(back?.ratio5),
      up25q: t.up25q,
      down25q: t.down25q,
      up13x34: t.up13x34,
      down13x34: t.down13x34,
      atrExt10: t.atrExt10,
      pctAbove50: r1(p50),
      pctAbove50FiveSessionsAgo: r1(back?.pctAbove50),
      pctAbove200: r1(p200),
      newHighs: t.newHighs,
      newLows: t.newLows,
      advancing: t.advancing,
      declining: t.declining,
    },
  }
}
