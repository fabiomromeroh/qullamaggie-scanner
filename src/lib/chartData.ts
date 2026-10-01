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
