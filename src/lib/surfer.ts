/**
 * Strict MA-surfer: the stock rides a moving average and bounces off it.
 *
 * A "10MA/20MA/50MA Surfer" tag is awarded only when every rule below holds
 * for that SMA over a recent window. Price merely sitting above the SMA is
 * the loose `aboveSma*` flag and is a different filter.
 *
 * SMA at bar i is the simple average of closes[i-period+1 .. i] (that bar
 * included). All comparisons use that contemporaneous SMA.
 */
import type { DailyBar } from './metrics'

export type MaKey = 'sma10' | 'sma20' | 'sma50'

export interface SurferConfig {
  /** Lookback windows in sessions, including the latest bar. */
  windowSessions: { sma10: number; sma20: number; sma50: number }
  /**
   * Fail if any close in the window is more than this percent below the SMA
   * as of that bar. 0.75 means a close 0.75% under the SMA is the limit.
   */
  closeBreakTolerancePct: number
  /**
   * A bar "touches" the SMA when its low is at most this percent above the
   * SMA, or pierces it (low <= SMA), AND the high still reaches the SMA
   * (the bar is not entirely below). 1.5 means low <= SMA * 1.015.
   */
  touchProximityPct: number
  /**
   * Distinct touch episodes required. Consecutive touch bars in a row count
   * as one episode. 50MA uses 2: a 25-session window on a slower average
   * rarely prints 3 clean tests.
   */
  minTouches: { sma10: number; sma20: number; sma50: number }
  /**
   * Sessions after a touch episode in which a bounce must appear.
   * Bounce bar: close > SMA (as of that bar) AND close > the representative
   * touch bar's close (which also means close > that bar's low).
   * The most recent episode is exempt if it ends within this many bars of
   * the latest session AND the latest close is still above the SMA.
   */
  bounceSessions: number
  /** SMA now must exceed SMA this many sessions ago (strictly up). */
  slopeLookback: { sma10: number; sma20: number; sma50: number }
}

export const SURFER_CONFIG: SurferConfig = {
  windowSessions: { sma10: 15, sma20: 15, sma50: 25 },
  closeBreakTolerancePct: 0.75,
  touchProximityPct: 1.5,
  minTouches: { sma10: 3, sma20: 3, sma50: 2 },
  bounceSessions: 3,
  slopeLookback: { sma10: 5, sma20: 5, sma50: 10 },
}

export interface SurferMaResult {
  ok: boolean
  /** Distinct touch-episode count in the window. */
  touches: number
  /** Episodes that printed a bounce (exempt open episode is not counted). */
  bounces: number
  /** Worst close-below-SMA percent in the window (0 if never below). */
  maxCloseBelowPct: number
  /** (SMA_now / SMA_N_ago − 1) × 100. 0 when SMA cannot be compared. */
  slopePct: number
  /** Present when ok is false. */
  reason?: string
}

export interface SurferResult {
  sma10: SurferMaResult
  sma20: SurferMaResult
  sma50: SurferMaResult
}

/** Compact payload for tooltips (no reasons). */
export interface SurferMaDetail {
  touches: number
  bounces: number
  slopePct: number
}

export interface SurferDetail {
  sma10: SurferMaDetail
  sma20: SurferMaDetail
  sma50: SurferMaDetail
}

const PERIOD: Record<MaKey, 10 | 20 | 50> = {
  sma10: 10,
  sma20: 20,
  sma50: 50,
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fail(
  extra: Partial<SurferMaResult> & { reason: string },
): SurferMaResult {
  return {
    ok: false,
    touches: extra.touches ?? 0,
    bounces: extra.bounces ?? 0,
    maxCloseBelowPct: extra.maxCloseBelowPct ?? 0,
    slopePct: extra.slopePct ?? 0,
    reason: extra.reason,
  }
}

/** SMA of closes[0..endIdx] inclusive, or null if fewer than `period` closes. */
export function smaAt(closes: number[], endIdx: number, period: number): number | null {
  if (period <= 0 || endIdx < period - 1 || endIdx >= closes.length) return null
  const slice = closes.slice(endIdx - period + 1, endIdx + 1)
  if (slice.some((c) => !Number.isFinite(c))) return null
  return avg(slice)
}

/**
 * Touch: low is within `touchProximityPct` above the SMA or pierces it,
 * and the high still reaches the SMA.
 */
export function isTouchBar(
  bar: DailyBar,
  sma: number,
  proximityPct: number = SURFER_CONFIG.touchProximityPct,
): boolean {
  if (!(sma > 0) || !Number.isFinite(bar.l) || !Number.isFinite(bar.h)) return false
  const lowVsSmaPct = ((bar.l - sma) / sma) * 100
  if (lowVsSmaPct > proximityPct) return false
  return bar.h >= sma
}

interface TouchEpisode {
  /** Inclusive window-local indices. */
  start: number
  end: number
  /** Bar index in `bars` of the deepest test (lowest low vs SMA). */
  touchIdx: number
}

function episodesFromFlags(
  flags: boolean[],
  windowStart: number,
  bars: DailyBar[],
  smaOf: (barIdx: number) => number | null,
): TouchEpisode[] {
  const out: TouchEpisode[] = []
  let i = 0
  while (i < flags.length) {
    if (!flags[i]) {
      i += 1
      continue
    }
    let j = i
    while (j + 1 < flags.length && flags[j + 1]) j += 1
    let touchIdx = windowStart + i
    let deepest = Number.POSITIVE_INFINITY
    for (let k = i; k <= j; k += 1) {
      const barIdx = windowStart + k
      const sma = smaOf(barIdx)
      const bar = bars[barIdx]!
      const depth = sma != null && sma > 0 ? (bar.l - sma) / sma : Number.POSITIVE_INFINITY
      if (depth < deepest) {
        deepest = depth
        touchIdx = barIdx
      }
    }
    out.push({ start: i, end: j, touchIdx })
    i = j + 1
  }
  return out
}

function bounceConfirmed(
  bars: DailyBar[],
  closes: number[],
  period: number,
  episodeEndBarIdx: number,
  touchIdx: number,
  bounceSessions: number,
): boolean {
  const touchClose = bars[touchIdx]!.c
  const last = bars.length - 1
  const from = episodeEndBarIdx + 1
  const to = Math.min(last, episodeEndBarIdx + bounceSessions)
  for (let j = from; j <= to; j += 1) {
    const sma = smaAt(closes, j, period)
    if (sma == null) continue
    const close = bars[j]!.c
    if (close > sma && close > touchClose && close > bars[touchIdx]!.l) return true
  }
  return false
}

export function evaluateMaSurfer(
  barsIn: DailyBar[],
  key: MaKey,
  config: SurferConfig = SURFER_CONFIG,
): SurferMaResult {
  const period = PERIOD[key]
  const windowSessions = config.windowSessions[key]
  const minTouches = config.minTouches[key]
  const slopeN = config.slopeLookback[key]
  const bars = [...barsIn].sort((a, b) => a.t - b.t)
  const n = bars.length
  const need = period + Math.max(windowSessions, slopeN)
  if (n < need) {
    return fail({ reason: `insufficient-bars (need ${need}, have ${n})` })
  }

  const closes = bars.map((b) => b.c)
  const last = n - 1
  const smaNow = smaAt(closes, last, period)
  const smaAgo = smaAt(closes, last - slopeN, period)
  const slopePct =
    smaNow != null && smaAgo != null && smaAgo > 0
      ? round2(((smaNow - smaAgo) / smaAgo) * 100)
      : 0

  if (smaNow == null) {
    return fail({ slopePct, reason: 'sma-undefined' })
  }

  const windowStart = n - windowSessions
  let maxCloseBelowPct = 0
  const touchFlags: boolean[] = []
  for (let i = windowStart; i <= last; i += 1) {
    const sma = smaAt(closes, i, period)
    if (sma == null || sma <= 0) {
      return fail({
        slopePct,
        reason: `sma-undefined at bar ${i}`,
      })
    }
    const closeBelow = ((sma - bars[i]!.c) / sma) * 100
    if (closeBelow > maxCloseBelowPct) maxCloseBelowPct = closeBelow
    touchFlags.push(isTouchBar(bars[i]!, sma, config.touchProximityPct))
  }
  maxCloseBelowPct = round2(maxCloseBelowPct)

  const smaOf = (barIdx: number) => smaAt(closes, barIdx, period)
  const episodes = episodesFromFlags(touchFlags, windowStart, bars, smaOf)
  const touches = episodes.length

  const lastClose = bars[last]!.c
  const holdingAbove = lastClose > smaNow

  let bounces = 0
  let missedBounce = false
  for (const ep of episodes) {
    const endBarIdx = windowStart + ep.end
    const open =
      last - endBarIdx < config.bounceSessions && holdingAbove
    if (open) continue
    if (bounceConfirmed(bars, closes, period, endBarIdx, ep.touchIdx, config.bounceSessions)) {
      bounces += 1
    } else {
      missedBounce = true
    }
  }

  const stats = { touches, bounces, maxCloseBelowPct, slopePct }

  if (maxCloseBelowPct > config.closeBreakTolerancePct) {
    return fail({
      ...stats,
      reason: `close-break (${maxCloseBelowPct}% below SMA, max ${config.closeBreakTolerancePct}%)`,
    })
  }
  if (touches < minTouches) {
    return fail({
      ...stats,
      reason: `too-few-touches (${touches} < ${minTouches})`,
    })
  }
  if (missedBounce) {
    return fail({
      ...stats,
      reason: 'no-bounce',
    })
  }
  if (!holdingAbove) {
    return fail({
      ...stats,
      reason: 'not-above-sma',
    })
  }
  if (!(smaAgo != null && smaNow > smaAgo)) {
    return fail({
      ...stats,
      reason: `slope-down (${slopePct}%)`,
    })
  }

  return {
    ok: true,
    ...stats,
  }
}

export function evaluateSurfer(
  bars: DailyBar[],
  config: SurferConfig = SURFER_CONFIG,
): SurferResult {
  return {
    sma10: evaluateMaSurfer(bars, 'sma10', config),
    sma20: evaluateMaSurfer(bars, 'sma20', config),
    sma50: evaluateMaSurfer(bars, 'sma50', config),
  }
}

export function compactSurferDetail(result: SurferResult): SurferDetail {
  const one = (r: SurferMaResult): SurferMaDetail => ({
    touches: r.touches,
    bounces: r.bounces,
    slopePct: r.slopePct,
  })
  return {
    sma10: one(result.sma10),
    sma20: one(result.sma20),
    sma50: one(result.sma50),
  }
}

export function surferBadgeTitle(
  tag: '10MA Surfer' | '20MA Surfer' | '50MA Surfer',
  detail?: SurferDetail | null,
): string {
  const key: MaKey =
    tag === '10MA Surfer' ? 'sma10' : tag === '20MA Surfer' ? 'sma20' : 'sma50'
  const d = detail?.[key]
  if (!d) return `${tag} (strict ride)`
  return `${tag}: ${d.touches} touches, ${d.bounces} bounces, slope ${d.slopePct}%`
}
