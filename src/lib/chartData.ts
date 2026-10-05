/** Pure helpers that turn daily OHLCV bars into lightweight-charts series. */

export interface OhlcvBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface CandlePoint {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface VolumePoint {
  time: number
  value: number
  color: string
}

export interface SmaPoint {
  time: number
  value: number | null
}

export const VOLUME_UP = '#3dd68c66'
export const VOLUME_DOWN = '#f0717866'

/** Sessions in the volume-average overlay. */
export const VOLUME_SMA_PERIOD = 20

/**
 * Empty bars kept to the right of the last candle.
 *
 * Lightweight Charts v5 `fitContent` reads `timeScale.rightOffset` when
 * `rightOffsetPixels` is unset, extends the fitted range by that many bars,
 * then pins the scroll offset back to the option. The chart panel sets this
 * in `createChart` and again immediately before and after `fitContent`.
 */
export const CHART_RIGHT_OFFSET_BARS = 10

export interface MeasureChange {
  /** (priceB − priceA) / priceA × 100 */
  pct: number
  /** priceB − priceA */
  abs: number
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function toCandles(bars: OhlcvBar[]): CandlePoint[] {
  const out: CandlePoint[] = []
  for (const bar of bars) {
    if (!finite(bar.t) || bar.t <= 0) continue
    if (!finite(bar.o) || !finite(bar.h) || !finite(bar.l) || !finite(bar.c)) continue
    out.push({ time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c })
  }
  return out
}

export function toVolume(bars: OhlcvBar[]): VolumePoint[] {
  const out: VolumePoint[] = []
  for (const bar of bars) {
    if (!finite(bar.t) || bar.t <= 0) continue
    const value = finite(bar.v) && bar.v >= 0 ? bar.v : 0
    const up = finite(bar.c) && finite(bar.o) ? bar.c >= bar.o : true
    out.push({ time: bar.t, value, color: up ? VOLUME_UP : VOLUME_DOWN })
  }
  return out
}

/**
 * SMA of closes. First `n - 1` points are null (warm-up).
 * Empty / n < 1 → all nulls, same length as `bars`.
 */
export function smaSeries(bars: OhlcvBar[], n: number): SmaPoint[] {
  const out: SmaPoint[] = []
  if (n < 1) {
    for (const bar of bars) out.push({ time: bar.t, value: null })
    return out
  }
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    const close = bars[i]!.c
    sum += close
    if (i >= n) sum -= bars[i - n]!.c
    if (i < n - 1) {
      out.push({ time: bars[i]!.t, value: null })
    } else {
      out.push({ time: bars[i]!.t, value: sum / n })
    }
  }
  return out
}

/**
 * Share volume used by {@link volumeSmaSeries}.
 * Missing, non-finite, and negative prints count as 0 so the window stays
 * aligned with the bar index. Skipping them would slide later averages onto
 * the wrong sessions.
 */
function volumeForAverage(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * SMA of share volume. Same length as `bars`.
 * The first `n - 1` points are null. `n < 1` or a non-finite `n` yields all nulls.
 * Default period is {@link VOLUME_SMA_PERIOD}.
 *
 * The panel draws this as a solid `#38bdf8` line on the volume scale (heavier
 * than the price averages). Price SMA 20 stays `#59c2ff` on the price scale.
 */
export function volumeSmaSeries(bars: OhlcvBar[], n = VOLUME_SMA_PERIOD): SmaPoint[] {
  const out: SmaPoint[] = []
  if (!(typeof n === 'number' && Number.isFinite(n) && n >= 1)) {
    for (const bar of bars) out.push({ time: bar.t, value: null })
    return out
  }
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += volumeForAverage(bars[i]!.v)
    if (i >= n) sum -= volumeForAverage(bars[i - n]!.v)
    if (i < n - 1) out.push({ time: bars[i]!.t, value: null })
    else out.push({ time: bars[i]!.t, value: sum / n })
  }
  return out
}

/**
 * Signed percent and dollar change from price A to price B.
 * Returns null when A is not above 0 or either input is non-finite.
 * The chart measure tool passes daily closes, not a freehand cursor price.
 */
export function measurePctChange(priceA: number, priceB: number): MeasureChange | null {
  if (typeof priceA !== 'number' || typeof priceB !== 'number') return null
  if (!Number.isFinite(priceA) || !Number.isFinite(priceB)) return null
  if (priceA <= 0) return null
  return { pct: ((priceB - priceA) / priceA) * 100, abs: priceB - priceA }
}
