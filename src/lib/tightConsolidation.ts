/**
 * Tight consolidation over a short recent window vs a quieter baseline.
 *
 * All thresholds live on {@link TIGHT_CONFIG}. `ok` requires every criterion.
 * This is independent of the older `tightDays` proxy in metrics.ts.
 */
import type { DailyBar } from './metrics'

export interface TightConfig {
  /** Recent contraction window (sessions). Documented range 5–10. */
  recentWindow: number
  /** Sessions immediately before the recent window used as the range baseline. Documented range 20–50. */
  baselineSessions: number
  /**
   * recent avg daily-range% / baseline avg daily-range% must be <= this.
   * 0.6 printed 0/187 ideas on a live scan (2026-10-02); 0.85 still requires
   * contraction and printed a low-single-digit share.
   */
  rangeRatioMax: number
  /**
   * Close-to-close spread over the recent window, as a multiple of baseline
   * ADR%. Spread = (max close − min close) / min close × 100.
   * Allowed spread is min(this × baseline ADR%, closeSpreadAbsMaxPct).
   */
  closeSpreadMaxMultipleOfAdr: number
  /** Absolute cap on the close-to-close spread percent. */
  closeSpreadAbsMaxPct: number
  /**
   * recent avg volume / trailing 50-session avg volume must be <= this.
   * 0.9 = recent volume at most 90% of the 50-day average (mild contraction).
   */
  volumeRatioMax: number
  /** Trailing sessions for the volume average (includes the recent window). */
  volumeAvgSessions: number
  /**
   * Price must be within this many percent of the 52-week high
   * (`pctFrom52wHigh >= -nearHighMaxPct`, same sign convention as metrics.ts).
   */
  nearHighMaxPct: number
  /** Bars used as the 52-week high window (same 252-session convention). */
  highLookback: number
  /** Loose price-above test: price must clear both of these SMA periods. */
  smaFast: number
  smaSlow: number
  /**
   * When true, `setupStageHeuristic` treats tightConsolidation + near highs
   * as an extra route into coiled. Live scan 2026-10-02: 66 coiled by the
   * legacy rule, 67 with this route (NET only, +1.5%). Left on.
   */
  useInCoiled: boolean
}

export const TIGHT_CONFIG: TightConfig = {
  recentWindow: 7,
  baselineSessions: 30,
  rangeRatioMax: 0.85,
  closeSpreadMaxMultipleOfAdr: 1.5,
  closeSpreadAbsMaxPct: 6,
  volumeRatioMax: 0.9,
  volumeAvgSessions: 50,
  nearHighMaxPct: 10,
  highLookback: 252,
  smaFast: 10,
  smaSlow: 20,
  useInCoiled: true,
}

export interface TightResult {
  ok: boolean
  rangeRatio: number
  closeSpreadPct: number
  volumeRatio: number
  days: number
  nearHigh: boolean
  aboveMas: boolean
  failedReasons: string[]
}

export interface TightDetail {
  rangeRatio: number
  closeSpreadPct: number
  volumeRatio: number
  days: number
  failedReasons?: string[]
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function smaClose(closes: number[], period: number): number | null {
  if (closes.length < period || period <= 0) return null
  return avg(closes.slice(-period))
}

function rangePct(bar: DailyBar): number {
  return bar.c > 0 ? ((bar.h - bar.l) / bar.c) * 100 : 0
}

export function evaluateTightConsolidation(
  barsIn: DailyBar[],
  price?: number,
  config: TightConfig = TIGHT_CONFIG,
): TightResult {
  const days = config.recentWindow
  const empty: TightResult = {
    ok: false,
    rangeRatio: 0,
    closeSpreadPct: 0,
    volumeRatio: 0,
    days,
    nearHigh: false,
    aboveMas: false,
    failedReasons: ['insufficient-bars'],
  }
  const bars = [...barsIn].sort((a, b) => a.t - b.t)
  const need = config.recentWindow + config.baselineSessions
  const volNeed = config.volumeAvgSessions
  const smaNeed = config.smaSlow
  if (bars.length < Math.max(need, volNeed, smaNeed)) {
    return empty
  }

  const last = bars[bars.length - 1]!
  const px = price != null && Number.isFinite(price) ? price : last.c
  const recent = bars.slice(-config.recentWindow)
  const baseline = bars.slice(
    -(config.recentWindow + config.baselineSessions),
    -config.recentWindow,
  )
  const volWindow = bars.slice(-config.volumeAvgSessions)

  const recentRange = avg(recent.map(rangePct))
  const baselineRange = avg(baseline.map(rangePct))
  const rangeRatio =
    baselineRange > 0 ? round4(recentRange / baselineRange) : Number.POSITIVE_INFINITY

  const closes = recent.map((b) => b.c)
  const minClose = Math.min(...closes)
  const maxClose = Math.max(...closes)
  const closeSpreadPct =
    minClose > 0 ? round2(((maxClose - minClose) / minClose) * 100) : Number.POSITIVE_INFINITY
  const spreadCap = Math.min(
    config.closeSpreadMaxMultipleOfAdr * baselineRange,
    config.closeSpreadAbsMaxPct,
  )

  const recentVol = avg(recent.map((b) => b.v))
  const avgVol50 = avg(volWindow.map((b) => b.v))
  const volumeRatio = avgVol50 > 0 ? round4(recentVol / avgVol50) : Number.POSITIVE_INFINITY

  const yearBars = bars.slice(-config.highLookback)
  const high52 = Math.max(...yearBars.map((b) => b.h))
  const pctFrom52wHigh = high52 > 0 ? ((px / high52) - 1) * 100 : 0
  const nearHigh = pctFrom52wHigh >= -config.nearHighMaxPct

  const allCloses = bars.map((b) => b.c)
  const smaFast = smaClose(allCloses, config.smaFast)
  const smaSlow = smaClose(allCloses, config.smaSlow)
  const aboveMas = smaFast != null && smaSlow != null && px > smaFast && px > smaSlow

  const failedReasons: string[] = []
  if (!(baselineRange > 0) || rangeRatio > config.rangeRatioMax) {
    failedReasons.push(
      `range-ratio ${Number.isFinite(rangeRatio) ? rangeRatio : 'inf'} > ${config.rangeRatioMax}`,
    )
  }
  if (!(minClose > 0) || closeSpreadPct > spreadCap) {
    failedReasons.push(
      `close-spread ${Number.isFinite(closeSpreadPct) ? closeSpreadPct : 'inf'}% > ${round2(spreadCap)}% cap`,
    )
  }
  if (!(avgVol50 > 0) || volumeRatio > config.volumeRatioMax) {
    failedReasons.push(
      `volume-ratio ${Number.isFinite(volumeRatio) ? volumeRatio : 'inf'} > ${config.volumeRatioMax}`,
    )
  }
  if (!nearHigh) {
    failedReasons.push(`far-from-high (${round2(pctFrom52wHigh)}%)`)
  }
  if (!aboveMas) {
    failedReasons.push('below-sma10-or-sma20')
  }

  return {
    ok: failedReasons.length === 0,
    rangeRatio: Number.isFinite(rangeRatio) ? rangeRatio : 0,
    closeSpreadPct: Number.isFinite(closeSpreadPct) ? closeSpreadPct : 0,
    volumeRatio: Number.isFinite(volumeRatio) ? volumeRatio : 0,
    days,
    nearHigh,
    aboveMas,
    failedReasons,
  }
}

export function compactTightDetail(result: TightResult): TightDetail {
  return {
    rangeRatio: result.rangeRatio,
    closeSpreadPct: result.closeSpreadPct,
    volumeRatio: result.volumeRatio,
    days: result.days,
    failedReasons: result.failedReasons,
  }
}

export function tightBadgeTitle(detail: TightDetail | null | undefined): string {
  if (!detail) return 'Tight consolidation (range + volume contraction near highs)'
  return `Tight: range ${detail.rangeRatio}×, vol ${detail.volumeRatio}×, spread ${detail.closeSpreadPct}%, ${detail.days}d`
}
