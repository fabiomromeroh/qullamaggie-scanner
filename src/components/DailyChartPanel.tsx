import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts'
import { smaSeries, toCandles, toVolume, type OhlcvBar } from '../lib/chartData'
import { fmtPct, fmtPrice, pctClass } from '../utils/format'

interface BarsResponse {
  symbol: string
  name?: string
  provider?: string
  asOf?: string
  bars?: OhlcvBar[]
  price?: number
  error?: string
}

interface Props {
  symbol: string
  name?: string
  price?: number | null
  dayPct?: number | null
}

const SMA_META = [
  { n: 10, label: 'SMA 10', color: '#c792ea', defaultOn: false },
  { n: 20, label: 'SMA 20', color: '#59c2ff', defaultOn: true },
  { n: 50, label: 'SMA 50', color: '#ffcc66', defaultOn: true },
  { n: 200, label: 'SMA 200', color: '#e6edf3', defaultOn: true },
] as const

type SmaN = (typeof SMA_META)[number]['n']

interface HoverState {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  sma: Partial<Record<SmaN, number | null>>
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10)
}

function hoverFromLastBar(bars: OhlcvBar[], enabled: Record<SmaN, boolean>): HoverState | null {
  const last = bars[bars.length - 1]
  if (!last) return null
  const sma: HoverState['sma'] = {}
  for (const meta of SMA_META) {
    if (!enabled[meta.n]) continue
    const pts = smaSeries(bars, meta.n)
    sma[meta.n] = pts[pts.length - 1]?.value ?? null
  }
  return {
    time: last.t,
    open: last.o,
    high: last.h,
    low: last.l,
    close: last.c,
    volume: last.v,
    sma,
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Daily candlestick chart that fills its parent. Previous bars stay on screen
 * while a newer symbol loads. Responses from an older request are ignored.
 */
export default function DailyChartPanel({ symbol, name, price, dayPct }: Props) {
  const [enabled, setEnabled] = useState<Record<SmaN, boolean>>({
    10: false,
    20: true,
    50: true,
    200: true,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bars, setBars] = useState<OhlcvBar[]>([])
  const [barsSymbol, setBarsSymbol] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [crosshair, setCrosshair] = useState<{ token: string; hover: HoverState } | null>(null)
  const [activeSymbol, setActiveSymbol] = useState(symbol)
  const barsToken = `${symbol}:${bars.length}:${bars[bars.length - 1]?.t ?? 0}`
  const tokenRef = useRef(barsToken)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const smaRef = useRef<Map<SmaN, ISeriesApi<'Line'>>>(new Map())
  const requestRef = useRef(0)
  const fittedBars = useRef<OhlcvBar[] | null>(null)

  const barsMatch = barsSymbol === symbol && bars.length > 0
  const showError = Boolean(error) && !loading
  const showSkeleton = !showError && bars.length === 0
  const showStale = !showError && !barsMatch && bars.length > 0
  const hideCanvas = showError || showSkeleton

  const lastHover = useMemo(() => hoverFromLastBar(bars, enabled), [bars, enabled])
  const liveCrosshair = crosshair && crosshair.token === barsToken ? crosshair.hover : null
  const hover = barsMatch && !showError ? (liveCrosshair ?? lastHover) : null

  if (symbol !== activeSymbol) {
    setActiveSymbol(symbol)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    tokenRef.current = barsToken
  }, [barsToken])

  useEffect(() => {
    const id = ++requestRef.current
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/market/bars/${encodeURIComponent(symbol)}`, {
          signal: ac.signal,
        })
        const body = (await res.json()) as BarsResponse
        if (ac.signal.aborted || id !== requestRef.current) return
        if (!res.ok) {
          throw new Error(body.error || `Chart data failed (${res.status})`)
        }
        const next = Array.isArray(body.bars) ? body.bars : []
        if (!next.length) throw new Error('No daily bars returned')
        setBars(next)
        setBarsSymbol(symbol)
        setError(null)
      } catch (err) {
        if (ac.signal.aborted || id !== requestRef.current || isAbort(err)) return
        setError(err instanceof Error ? err.message : 'Chart data unavailable')
      } finally {
        if (!ac.signal.aborted && id === requestRef.current) setLoading(false)
      }
    })()
    return () => {
      ac.abort()
    }
  }, [symbol, retry])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    // Drop series tied to a chart this effect is about to replace (strict-mode remount).
    candleRef.current = null
    volumeRef.current = null
    smaRef.current = new Map()

    const chart: IChartApi = createChart(el, {
      autoSize: false,
      width: Math.max(el.clientWidth, 0),
      height: Math.max(el.clientHeight, 0),
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e14' },
        textColor: '#8b9cb3',
        fontFamily: 'JetBrains Mono, SF Mono, ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: '#1e2733' },
        horzLines: { color: '#1e2733' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a3544' },
      timeScale: {
        borderColor: '#2a3544',
        timeVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    })
    chartRef.current = chart

    const applySize = () => {
      const node = hostRef.current
      if (!node) return
      const width = node.clientWidth
      const height = node.clientHeight
      if (width <= 0 || height <= 0) return
      chart.applyOptions({ width, height })
    }
    applySize()
    const ro = new ResizeObserver(applySize)
    ro.observe(el)

    chart.subscribeCrosshairMove((param) => {
      const candleSeries = candleRef.current
      const volumeSeries = volumeRef.current
      if (!param.time || !candleSeries) {
        setCrosshair(null)
        return
      }
      const candle = param.seriesData.get(candleSeries) as CandlestickData | undefined
      if (!candle || typeof candle.open !== 'number') {
        setCrosshair(null)
        return
      }
      const vol = volumeSeries
        ? (param.seriesData.get(volumeSeries) as HistogramData | undefined)
        : undefined
      const sma: HoverState['sma'] = {}
      for (const [n, api] of smaRef.current) {
        const pt = param.seriesData.get(api) as LineData | undefined
        sma[n] = pt && typeof pt.value === 'number' ? pt.value : null
      }
      const time =
        typeof param.time === 'number'
          ? param.time
          : typeof param.time === 'string'
            ? Date.parse(param.time) / 1000
            : candle.time && typeof candle.time === 'number'
              ? candle.time
              : 0
      setCrosshair({
        token: tokenRef.current,
        hover: {
          time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: typeof vol?.value === 'number' ? vol.value : null,
          sma,
        },
      })
    })

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || bars.length === 0) return
    const barsChanged = fittedBars.current !== bars
    fittedBars.current = bars
    let createdCandle = false
    let candle = candleRef.current
    if (!candle) {
      createdCandle = true
      candle = chart.addSeries(CandlestickSeries, {
        upColor: '#3dd68c',
        downColor: '#f07178',
        borderVisible: false,
        wickUpColor: '#3dd68c',
        wickDownColor: '#f07178',
      })
      candle.priceScale().applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.28 },
      })
      candleRef.current = candle
    }
    candle.setData(
      toCandles(bars).map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

    let volume = volumeRef.current
    if (!volume) {
      volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
        borderVisible: false,
      })
      volumeRef.current = volume
    }
    volume.setData(
      toVolume(bars).map((v) => ({
        time: v.time as UTCTimestamp,
        value: v.value,
        color: v.color,
      })),
    )

    const live = new Set<SmaN>()
    for (const meta of SMA_META) {
      if (!enabled[meta.n]) continue
      live.add(meta.n)
      let series = smaRef.current.get(meta.n)
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: meta.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        smaRef.current.set(meta.n, series)
      }
      series.applyOptions({ color: meta.color })
      const points = smaSeries(bars, meta.n)
        .filter((p): p is { time: number; value: number } => p.value != null)
        .map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      series.setData(points)
    }
    for (const [n, series] of smaRef.current) {
      if (live.has(n)) continue
      chart.removeSeries(series)
      smaRef.current.delete(n)
    }

    if (createdCandle || barsChanged) chart.timeScale().fitContent()
  }, [bars, enabled])

  function toggleSma(n: SmaN) {
    setEnabled((prev) => ({ ...prev, [n]: !prev[n] }))
  }

  const priceLabel = price != null && Number.isFinite(price) ? fmtPrice(price) : null
  const dayLabel = dayPct != null && Number.isFinite(dayPct) ? fmtPct(dayPct) : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-terminal-bg">
      <header className="shrink-0 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="font-mono text-lg font-bold text-terminal-fg">{symbol}</h2>
          {name ? <span className="truncate text-xs text-terminal-muted">{name}</span> : null}
          {priceLabel ? (
            <span className="font-mono text-sm text-terminal-fg">{priceLabel}</span>
          ) : null}
          {dayLabel ? (
            <span className={`font-mono text-sm ${pctClass(dayPct ?? 0)}`}>{dayLabel}</span>
          ) : null}
          <span className="text-[10px] uppercase tracking-wide text-terminal-dim">Daily</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SMA_META.map((meta) => {
            const on = enabled[meta.n]
            return (
              <button
                key={meta.n}
                type="button"
                onClick={() => toggleSma(meta.n)}
                aria-pressed={on}
                className={`min-h-10 rounded-full border px-3 text-[11px] font-mono ${
                  on
                    ? 'border-terminal-border-bright bg-terminal-elevated text-terminal-fg'
                    : 'border-terminal-border text-terminal-dim'
                }`}
                style={on ? { boxShadow: `inset 0 -2px 0 ${meta.color}` } : undefined}
              >
                {meta.label}
              </button>
            )
          })}
        </div>
      </header>

      {hover ? (
        <div className="shrink-0 px-3 py-1 font-mono text-[11px] text-terminal-muted sm:px-4">
          <span className="text-terminal-fg">{barDate(hover.time)}</span>
          {'  '}O {fmtPrice(hover.open)} H {fmtPrice(hover.high)} L {fmtPrice(hover.low)} C{' '}
          {fmtPrice(hover.close)}
          {hover.volume != null ? `  V ${fmtVol(hover.volume)}` : ''}
          {SMA_META.filter((m) => enabled[m.n] && hover.sma[m.n] != null).map((m) => (
            <span key={m.n} style={{ color: m.color }}>
              {'  '}
              {m.n}:{fmtPrice(hover.sma[m.n]!)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className={`h-full w-full ${hideCanvas || showStale ? 'pointer-events-none' : ''} ${
            hideCanvas ? 'invisible' : ''
          }`}
        />
        {showSkeleton ? (
          <div
            className="absolute inset-0 flex flex-col gap-3 p-4"
            aria-busy="true"
            aria-live="polite"
          >
            <div className="flex-1 animate-pulse rounded bg-terminal-elevated" />
            <p className="text-center text-sm text-terminal-muted">Loading daily bars…</p>
          </div>
        ) : null}
        {showStale ? (
          <div className="pointer-events-none absolute inset-0 bg-terminal-bg/35" aria-busy="true">
            <div className="absolute left-3 top-3 rounded-full border border-terminal-border bg-terminal-panel/95 px-3 py-1 text-[11px] text-terminal-muted">
              Loading {symbol}…
            </div>
          </div>
        ) : null}
        {loading && barsMatch ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-terminal-border bg-terminal-panel/95 px-3 py-1 text-[11px] text-terminal-muted">
            Refreshing…
          </div>
        ) : null}
        {showError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-terminal-bg px-4 text-center">
            <p className="text-sm text-terminal-red">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setLoading(true)
                setRetry((n) => n + 1)
              }}
              className="min-h-10 rounded-md border border-terminal-border-bright bg-terminal-elevated px-4 text-xs text-terminal-fg"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>

      <p className="shrink-0 px-3 py-1 text-[9px] text-terminal-dim sm:px-4">
        Lightweight Charts by TradingView · SMA overlays computed from these bars
      </p>
    </div>
  )
}
