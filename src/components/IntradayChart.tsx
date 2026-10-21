import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { smaSeries, toCandles, toVolume, type OhlcvBar } from '../lib/chartData'

export type IntradayInterval = '1m' | '30m' | '1h'

const MAS = [
  { n: 9, color: '#59c2ff' },
  { n: 20, color: '#ffcc66' },
  { n: 50, color: '#c792ea' },
]

/** Yahoo intraday candles (regular session) with 9/20/50-bar SMAs and volume. Times shown in ET. */
export function IntradayChart({ symbol, interval }: { symbol: string; interval: IntradayInterval }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [bars, setBars] = useState<OhlcvBar[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/ticker/${encodeURIComponent(symbol)}/intraday?interval=${interval}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = (await res.json()) as { bars?: OhlcvBar[]; error?: string }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        setBars(body.bars ?? [])
        setError(null)
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : 'Request failed')
      })
    return () => ctrl.abort()
  }, [symbol, interval])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !bars?.length) return
    // Shift UTC seconds to New York wall time so the axis reads in ET.
    const etOffset = (t: number) => {
      const d = new Date(t * 1000)
      const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
      return (et.getTime() - utc.getTime()) / 1000
    }
    const shifted = bars.map((b) => ({ ...b, t: b.t + etOffset(b.t) }))
    const chart: IChartApi = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e14' },
        textColor: '#8b9cb3',
        fontFamily: 'JetBrains Mono, SF Mono, ui-monospace, monospace',
      },
      grid: { vertLines: { color: '#1e2733' }, horzLines: { color: '#1e2733' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a3544' },
      timeScale: { borderColor: '#2a3544', timeVisible: true, secondsVisible: false },
    })
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#3dd68c',
      downColor: '#f07178',
      borderVisible: false,
      wickUpColor: '#3dd68c',
      wickDownColor: '#f07178',
    })
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } })
    candle.setData(toCandles(shifted).map((c) => ({ ...c, time: c.time as UTCTimestamp })))
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' } })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    vol.setData(toVolume(shifted).map((v) => ({ ...v, time: v.time as UTCTimestamp })))
    for (const ma of MAS) {
      const line = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      line.setData(
        smaSeries(shifted, ma.n)
          .filter((p) => p.value != null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.value as number })),
      )
    }
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [bars])

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-1 flex gap-2 text-[10px]">
        {MAS.map((m) => (
          <span key={m.n} style={{ color: m.color }}>
            SMA {m.n}
          </span>
        ))}
        <span className="text-terminal-dim">{interval} · ET · Yahoo</span>
      </div>
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-terminal-red">{error}</div>
      ) : !bars ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-terminal-muted">Loading {interval} bars…</div>
      ) : bars.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-terminal-muted">No {interval} bars.</div>
      ) : null}
    </div>
  )
}
