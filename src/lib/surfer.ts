/**
 * Strict MA-surfer: price rides a moving average, measured as distance
 * relative to the stock's own ADR%. Discrete touch counts are not used.
 *
 * A "10MA/20MA/50MA Surfer" tag is awarded only when every rule below holds
 * for that SMA over a recent window. Price merely sitting above the SMA is
 * the loose `aboveSma*` flag and is a different filter.
 *
 * SMA at bar i is the simple average of closes[i-period+1 .. i] (that bar
 * included). All comparisons use that contemporaneous SMA.
 *
 * adrPct is the mean of (high − low) / close × 100 over the 20 sessions
 * before the latest bar — the same slice `computeIdeaMetrics` uses.
 * Pass that already-computed value so the two cannot diverge. When omitted,
 * {@link adrPctFromBars} computes it from the bars.
 *
 * Allowed distance scales with ADR%: a high-ADR name may sit farther from
 * the average (in percent) and still count as riding it.
 */
import type { DailyBar } from './metrics'

export type MaKey = 'sma10' | 'sma20' | 'sma50'

export interface SurferConfig {
  /** Lookback windows in sessions, including the latest bar. */
  windowSessions: { sma10: number; sma20: number; sma50: number }
  /** SMA now is compared with SMA this many sessions ago. */
  slopeLookback: { sma10: number; sma20: number; sma50: number }
  /**
   * proximityPct = kProximity × adrPct. A bar is near the SMA when
   * ((low − SMA) / SMA) × 100 <= proximityPct (low within that percent
   * above the SMA, or through it).
   */
  kProximity: { sma10: number; sma20: number; sma50: number }
  /**
   * breakTolerancePct = kBreak × adrPct. A close may dip this far under the
   * SMA (percent of the SMA) and still count if it recovers. Must be >= 0.
   * A deeper close fails even when price later comes back.
   */
  kBreak: { sma10: number; sma20: number; sma50: number }
  /**
   * Latest price may sit this many ADR multiples under the SMA and still
   * count as "at" the SMA. Also the threshold that separates a hold from a
   * shallow dip that must recover.
   */
  latestToleranceAdr: number
  /**
   * Fail when (price − SMA) / SMA × 100 is greater than this × adrPct.
   * A name that has already run far above the average is extended, not riding it.
   */
  maxExtensionAdrMultiple: number
  /**
   * Share of window bars whose low is near the SMA (or through it).
   * 0.40 is "often near", not a strict majority. The recent-bar alternative
   * ({@link recentNearSessions}) can also satisfy the near test.
   */
  nearFraction: number
  /** At least one near bar inside the last N bars of the window also passes the near test. */
  recentNearSessions: number
  /**
   * Sessions after a shallow close-below in which a later close must be back
   * at or above that later bar's SMA. The latest bar cannot recover itself.
   */
  recoverySessions: number
  /**
   * false: SMA now must be strictly above SMA N sessions ago.
   * true: a flat slope (>=) passes. Kept strict until a live scan shows
   * the up-slope gate is too rare.
   */
  slopeAllowFlat: boolean
  /** Sessions before the latest bar used when adrPct is computed here. */
  adrSessions: number
}

/**
 * Starting k values (2026-10-02), tuned so each flag stays roughly 3–15% of
 * a full scan. Higher k on the slower average: a 50-day mean sits farther
 * from price on a normal pullback than a 10-day mean.
 */
export const SURFER_CONFIG: SurferConfig = {
  windowSessions: { sma10: 15, sma20: 15, sma50: 25 },
  slopeLookback: { sma10: 5, sma20: 5, sma50: 10 },
  kProximity: { sma10: 0.35, sma20: 0.5, sma50: 0.75 },
  kBreak: { sma10: 0.5, sma20: 0.5, sma50: 0.5 },
  latestToleranceAdr: 0.05,
  maxExtensionAdrMultiple: 1.75,
  nearFraction: 0.4,
  recentNearSessions: 4,
  recoverySessions: 3,
  slopeAllowFlat: false,
  adrSessions: 20,
}

export interface SurferMaResult {
  ok: boolean
  /** (price − SMA) / SMA × 100. Positive means price is above the SMA. */
  distancePct: number
  /** distancePct / adrPct. Positive means above. 0 when adrPct is 0. */
  distanceAdr: number
  /** Window bars whose low is within proximityPct above the SMA or through it. */
  nearBars: number
  windowBars: number
  /** Closest low versus the SMA in the window, percent. Negative if a low pierced it. */
  minDistancePct: number
  /** Worst close-below-SMA percent in the window (0 if never below). */
  maxCloseBelowPct: number
  /**
   * True when every shallow close-below recovered within recoverySessions,
   * or when there was no shallow dip. False when a dip is still open.
   */
  recovered: boolean
  /** (SMA_now / SMA_N_ago − 1) × 100. 0 when the SMA cannot be compared. */
  slopePct: number
  adrPct: number
  /** kProximity × adrPct for this average. */
  proximityPct: number
  /** Present when ok is false. */
  reason?: string
}

export interface SurferResult {
  sma10: SurferMaResult
  sma20: SurferMaResult
  sma50: SurferMaResult
}

/** Compact payload stored on the idea (includes the failure reason when present). */
export type SurferMaDetail = SurferMaResult

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

/** SMA of closes[0..endIdx] inclusive, or null if fewer than `period` closes. */
export function smaAt(closes: number[], endIdx: number, period: number): number | null {
  if (period <= 0 || endIdx < period - 1 || endIdx >= closes.length) return null
  const slice = closes.slice(endIdx - period + 1, endIdx + 1)
  if (slice.some((c) => !Number.isFinite(c))) return null
  return avg(slice)
}

/**
 * Mean (high − low) / close × 100 over the `sessions` bars immediately
 * before the latest bar. Same window as metrics.ts ADR%.
 */
export function adrPctFromBars(
  barsIn: DailyBar[],
  sessions: number = SURFER_CONFIG.adrSessions,
): number {
  const bars = [...barsIn].sort((a, b) => a.t - b.t)
  if (bars.length < 2 || sessions <= 0) return 0
  const lookback = bars.slice(-(sessions + 1), -1)
  if (!lookback.length) return 0
  return avg(lookback.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0)))
}

function emptyResult(
  windowBars: number,
  adr: number,
  proximityPct: number,
  reason: string,
): SurferMaResult {
  return {
    ok: false,
    distancePct: 0,
    distanceAdr: 0,
    nearBars: 0,
    windowBars,
    minDistancePct: 0,
    maxCloseBelowPct: 0,
    recovered: false,
    slopePct: 0,
    adrPct: round2(adr),
    proximityPct: round2(proximityPct),
    reason,
  }
}

export function evaluateMaSurfer(
  barsIn: DailyBar[],
  key: MaKey,
  config: SurferConfig = SURFER_CONFIG,
  adrPct?: number,
  price?: number,
): SurferMaResult {
  const period = PERIOD[key]
  const windowSessions = config.windowSessions[key]
  const slopeN = config.slopeLookback[key]
  const bars = [...barsIn].sort((a, b) => a.t - b.t)
  const n = bars.length
  const adr =
    adrPct != null && Number.isFinite(adrPct) && adrPct >= 0
      ? adrPct
      : adrPctFromBars(bars, config.adrSessions)
  const proximityPct = config.kProximity[key] * adr
  const breakTolerancePct = Math.max(0, config.kBreak[key] * adr)
  const latestTolPct = Math.max(0, config.latestToleranceAdr * adr)
  const need = period + Math.max(windowSessions, slopeN)

  if (n < need) {
    return emptyResult(windowSessions, adr, proximityPct, `insufficient-bars (need ${need}, have ${n})`)
  }

  const closes = bars.map((b) => b.c)
  const last = n - 1
  const smaNow = smaAt(closes, last, period)
  const smaAgo = smaAt(closes, last - slopeN, period)
  const slopePct =
    smaNow != null && smaAgo != null && smaAgo > 0
      ? round2(((smaNow - smaAgo) / smaAgo) * 100)
      : 0

  if (smaNow == null || !(smaNow > 0)) {
    return {
      ...emptyResult(windowSessions, adr, proximityPct, 'sma-undefined'),
      slopePct,
    }
  }

  const px = price != null && Number.isFinite(price) ? price : bars[last]!.c
  const distRaw = ((px - smaNow) / smaNow) * 100
  const distancePct = round2(distRaw)
  const distanceAdr = adr > 0 ? round2(distancePct / adr) : 0

  const windowStart = n - windowSessions
  let maxCloseBelowPct = 0
  let minDistancePct = Number.POSITIVE_INFINITY
  let nearBars = 0
  let recentNear = false
  let deepBreak = false
  const shallowDips: number[] = []

  for (let i = windowStart; i <= last; i += 1) {
    const sma = smaAt(closes, i, period)
    if (sma == null || !(sma > 0)) {
      return {
        ok: false,
        distancePct,
        distanceAdr,
        nearBars,
        windowBars: windowSessions,
        minDistancePct: Number.isFinite(minDistancePct) ? round2(minDistancePct) : 0,
        maxCloseBelowPct: round2(maxCloseBelowPct),
        recovered: false,
        slopePct,
        adrPct: round2(adr),
        proximityPct: round2(proximityPct),
        reason: `sma-undefined at bar ${i}`,
      }
    }
    const closeBelowPct = ((sma - bars[i]!.c) / sma) * 100
    if (closeBelowPct > maxCloseBelowPct) maxCloseBelowPct = closeBelowPct
    const lowDistPct = ((bars[i]!.l - sma) / sma) * 100
    if (lowDistPct < minDistancePct) minDistancePct = lowDistPct
    if (lowDistPct <= proximityPct) {
      nearBars += 1
      if (i >= last - config.recentNearSessions + 1) recentNear = true
    }
    if (closeBelowPct > breakTolerancePct) deepBreak = true
    else if (closeBelowPct > latestTolPct) shallowDips.push(i)
  }

  let recovered = true
  for (const dip of shallowDips) {
    if (dip >= last) {
      recovered = false
      break
    }
    let back = false
    const to = Math.min(last, dip + config.recoverySessions)
    for (let j = dip + 1; j <= to; j += 1) {
      const smaJ = smaAt(closes, j, period)
      if (smaJ == null || !(smaJ > 0)) continue
      const below = ((smaJ - bars[j]!.c) / smaJ) * 100
      if (below <= latestTolPct) {
        back = true
        break
      }
    }
    if (!back) {
      recovered = false
      break
    }
  }

  const stats: Omit<SurferMaResult, 'ok' | 'reason'> = {
    distancePct,
    distanceAdr,
    nearBars,
    windowBars: windowSessions,
    minDistancePct: round2(Number.isFinite(minDistancePct) ? minDistancePct : 0),
    maxCloseBelowPct: round2(maxCloseBelowPct),
    recovered,
    slopePct,
    adrPct: round2(adr),
    proximityPct: round2(proximityPct),
  }

  const nearEnough = windowSessions > 0 && (nearBars / windowSessions >= config.nearFraction || recentNear)
  const holdingAbove = distRaw >= -latestTolPct
  const extended = adr > 0 && distRaw > config.maxExtensionAdrMultiple * adr
  const slopeUp =
    smaAgo != null && (config.slopeAllowFlat ? smaNow >= smaAgo : smaNow > smaAgo)

  if (deepBreak) return { ok: false, ...stats, reason: 'deep-break' }
  if (!recovered) return { ok: false, ...stats, reason: 'unrecovered-break' }
  if (!nearEnough) return { ok: false, ...stats, reason: 'not-near' }
  if (!holdingAbove) return { ok: false, ...stats, reason: 'not-above-sma' }
  if (extended) return { ok: false, ...stats, reason: 'extended' }
  if (!slopeUp) return { ok: false, ...stats, reason: 'slope-down' }
  return { ok: true, ...stats }
}

export function evaluateSurfer(
  bars: DailyBar[],
  config: SurferConfig = SURFER_CONFIG,
  adrPct?: number,
  price?: number,
): SurferResult {
  return {
    sma10: evaluateMaSurfer(bars, 'sma10', config, adrPct, price),
    sma20: evaluateMaSurfer(bars, 'sma20', config, adrPct, price),
    sma50: evaluateMaSurfer(bars, 'sma50', config, adrPct, price),
  }
}

export function compactSurferDetail(result: SurferResult): SurferDetail {
  return {
    sma10: { ...result.sma10 },
    sma20: { ...result.sma20 },
    sma50: { ...result.sma50 },
  }
}

const MA_LABEL: Record<MaKey, string> = {
  sma10: '10MA',
  sma20: '20MA',
  sma50: '50MA',
}

/** Signed percent and ADR-multiple line, e.g. "+0.8% above 20MA = 0.2 ADR". */
export function formatSurferDistance(maLabel: string, detail: SurferMaDetail): string {
  const signed = detail.distancePct > 0 ? `+${detail.distancePct}` : `${detail.distancePct}`
  const side = detail.distancePct >= 0 ? 'above' : 'below'
  const rec = detail.recovered ? 'recovered' : 'not recovered'
  return `${signed}% ${side} ${maLabel} = ${Math.abs(detail.distanceAdr)} ADR · near ${detail.nearBars}/${detail.windowBars} · slope ${detail.slopePct}% · ${rec}`
}

export function surferBadgeTitle(
  tag: '10MA Surfer' | '20MA Surfer' | '50MA Surfer',
  detail?: SurferDetail | null,
): string {
  const key: MaKey =
    tag === '10MA Surfer' ? 'sma10' : tag === '20MA Surfer' ? 'sma20' : 'sma50'
  const d = detail?.[key]
  if (!d) return `${tag} (strict ride)`
  return `${tag}: ${formatSurferDistance(MA_LABEL[key], d)}`
}
