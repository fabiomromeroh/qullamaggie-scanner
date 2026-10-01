import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
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
import { fmtPrice } from '../utils/format'

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
  onClose: () => void
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

function hoverFromLastBar(
  bars: OhlcvBar[],
  enabled: Record<SmaN, boolean>,
): HoverState | null {
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

export default function DailyChartOverlay({ symbol, name, onClose }: Props) {
  const [enabled, setEnabled] = useState<Record<SmaN, boolean>>({
    10: false,
    20: true,
    50: true,
    200: true,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bars, setBars] = useState<OhlcvBar[]>([])
  const [retry, setRetry] = useState(0)
  const hostRef = useRef<HTMLDivElement | null>(null)

  const lastHover = useMemo(() => hoverFromLastBar(bars, enabled), [bars, enabled])
  const [crosshair, setCrosshair] = useState<HoverState | null>(null)
  const hover = crosshair ?? lastHover

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/market/bars/${encodeURIComponent(symbol)}`, {
          signal: ac.signal,
        })
        const body = (await res.json()) as BarsResponse
        if (ac.signal.aborted) return
        if (!res.ok) {
          throw new Error(body.error || `Chart data failed (${res.status})`)
        }
        const next = Array.isArray(body.bars) ? body.bars : []
        if (!next.length) throw new Error('No daily bars returned')
        setBars(next)
        setError(null)
      } catch (err) {
        if (ac.signal.aborted) return
        setBars([])
        setError(err instanceof Error ? err.message : 'Chart data unavailable')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [symbol, retry])

  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !bars.length) return

    const chart: IChartApi = createChart(el, {
      autoSize: false,
      width: el.clientWidth,
      height: el.clientHeight,
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#3dd68c',
      downColor: '#f07178',
      borderVisible: false,
      wickUpColor: '#3dd68c',
      wickDownColor: '#f07178',
    })
    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.28 },
    })
    candleSeries.setData(
      toCandles(bars).map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      borderVisible: false,
    })
    volumeSeries.setData(
      toVolume(bars).map((v) => ({
        time: v.time as UTCTimestamp,
        value: v.value,
        color: v.color,
      })),
    )

    const smaApis = new Map<SmaN, ISeriesApi<'Line'>>()
    for (const meta of SMA_META) {
      if (!enabled[meta.n]) continue
      const series = chart.addSeries(LineSeries, {
        color: meta.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      const points = smaSeries(bars, meta.n)
        .filter((p): p is { time: number; value: number } => p.value != null)
        .map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      series.setData(points)
      smaApis.set(meta.n, series)
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setCrosshair(null)
        return
      }
      const candle = param.seriesData.get(candleSeries) as CandlestickData | undefined
      if (!candle || typeof candle.open !== 'number') {
        setCrosshair(null)
        return
      }
      const vol = param.seriesData.get(volumeSeries) as HistogramData | undefined
      const sma: HoverState['sma'] = {}
      for (const [n, api] of smaApis) {
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
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: typeof vol?.value === 'number' ? vol.value : null,
        sma,
      })
    })

    const ro = new ResizeObserver(() => {
      if (!hostRef.current) return
      chart.applyOptions({
        width: hostRef.current.clientWidth,
        height: hostRef.current.clientHeight,
      })
    })
    ro.observe(el)
    chart.timeScale().fitContent()

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [bars, enabled])

  function toggleSma(n: SmaN) {
    setEnabled((prev) => ({ ...prev, [n]: !prev[n] }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} daily chart`}
        className="flex h-full w-full flex-col bg-terminal-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] sm:absolute sm:inset-3 sm:h-auto sm:rounded-lg sm:border sm:border-terminal-border"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-terminal-border px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-lg font-bold text-terminal-fg">{symbol}</h2>
              {name ? <span className="truncate text-xs text-terminal-muted">{name}</span> : null}
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
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 min-w-10 shrink-0 rounded p-2 text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-fg"
            aria-label="Close chart and details"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {hover && !loading && !error ? (
          <div className="shrink-0 px-3 py-1.5 font-mono text-[11px] text-terminal-muted sm:px-4">
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
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-terminal-muted">
              Loading daily bars…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="text-sm text-terminal-red">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  setError(null)
                  setRetry((n) => n + 1)
                }}
                className="min-h-10 rounded-md border border-terminal-border-bright bg-terminal-elevated px-4 text-xs text-terminal-fg"
              >
                Retry
              </button>
            </div>
          ) : (
            <div ref={hostRef} className="h-full w-full" />
          )}
        </div>

        <p className="shrink-0 px-3 py-1 text-[9px] text-terminal-dim sm:px-4">
          Lightweight Charts by TradingView · SMA overlays computed from these bars
        </p>
      </div>
    </div>
  )
}
