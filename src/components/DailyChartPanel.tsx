import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  CHART_RIGHT_OFFSET_BARS,
  VOLUME_SMA_PERIOD,
  measurePctChange,
  smaSeries,
  toCandles,
  toVolume,
  volumeSmaSeries,
  type OhlcvBar,
} from '../lib/chartData'
import {
  loadSmaColors,
  parseSmaColors,
  saveSmaColors,
  type SmaColorKey,
  type SmaColorMap,
} from '../lib/chartSmaColors'
import {
  extensionAdr50Tone,
  extensionAdrFrom50,
  formatExtensionAdr50,
  roundExtensionAdr50,
} from '../lib/extensionAdr'
import { BAR_WINDOWS, SMA_PERIODS, smaClose } from '../lib/metrics'
import { metricTipAttrs } from '../lib/metricDefinitions'
import { fmtPct, fmtPrice, pctClass } from '../utils/format'
import { MetricTip } from './MetricTip'

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
  /** Stored ADR extension from the 50 SMA. Used when present; otherwise recomputed from bars. */
  extensionAdr50?: number | null
  adrPct?: number | null
  sma50?: number | null
}

const SMA_META = [
  { n: SMA_PERIODS.sma10, key: '10' as const, label: 'SMA 10', defaultOn: false },
  { n: SMA_PERIODS.sma20, key: '20' as const, label: 'SMA 20', defaultOn: true },
  { n: SMA_PERIODS.sma50, key: '50' as const, label: 'SMA 50', defaultOn: true },
  { n: SMA_PERIODS.sma200, key: '200' as const, label: 'SMA 200', defaultOn: true },
] as const

type SmaN = (typeof SMA_META)[number]['n']

const COLOR_INPUT_CLASS =
  'h-10 w-10 shrink-0 cursor-pointer rounded-md border border-terminal-border bg-terminal-bg p-0.5'

interface HoverState {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  sma: Partial<Record<SmaN, number | null>>
  volumeSma: number | null
}

interface MeasurePoint {
  time: number
  date: string
  close: number
}

interface MeasurePoints {
  a: MeasurePoint | null
  b: MeasurePoint | null
}

const EMPTY_MEASURE: MeasurePoints = { a: null, b: null }

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

function fmtDollarChange(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${sign}$${fmtPrice(Math.abs(n))}`
}

function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10)
}

function eventTime(time: Time, fallback = 0): number {
  if (typeof time === 'number') return Number.isFinite(time) ? time : fallback
  if (typeof time === 'string') {
    const parsed = Date.parse(time)
    return Number.isFinite(parsed) ? parsed / 1000 : fallback
  }
  const parsed = Date.UTC(time.year, time.month - 1, time.day) / 1000
  return Number.isFinite(parsed) ? parsed : fallback
}

function chipClass(on: boolean): string {
  return `min-h-10 cursor-help rounded-full border px-3 text-[11px] font-mono ${
    on
      ? 'border-terminal-border-bright bg-terminal-elevated text-terminal-fg'
      : 'border-terminal-border text-terminal-dim'
  }`
}

function hoverFromLastBar(
  bars: OhlcvBar[],
  enabled: Record<SmaN, boolean>,
  volSmaOn: boolean,
): HoverState | null {
  const last = bars[bars.length - 1]
  if (!last) return null
  const sma: HoverState['sma'] = {}
  for (const meta of SMA_META) {
    if (!enabled[meta.n]) continue
    const pts = smaSeries(bars, meta.n)
    sma[meta.n] = pts[pts.length - 1]?.value ?? null
  }
  let volumeSma: number | null = null
  if (volSmaOn) {
    const pts = volumeSmaSeries(bars, VOLUME_SMA_PERIOD)
    volumeSma = pts[pts.length - 1]?.value ?? null
  }
  return {
    time: last.t,
    open: last.o,
    high: last.h,
    low: last.l,
    close: last.c,
    volume: last.v,
    sma,
    volumeSma,
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function adrPctFromChartBars(bars: OhlcvBar[]): number | null {
  const lookback = bars.slice(-(BAR_WINDOWS.adrSessions + 1), -1)
  if (!lookback.length) return null
  let sum = 0
  for (const bar of lookback) {
    sum += bar.c > 0 ? ((bar.h - bar.l) / bar.c) * 100 : 0
  }
  return sum / lookback.length
}

/**
 * Prefer the idea field when it is a finite number (including 0).
 * Otherwise recompute from bars + ADR so a missing payload still shows a value.
 */
function resolveChartExtensionAdr50(opts: {
  stored?: number | null
  price?: number | null
  sma50?: number | null
  adrPct?: number | null
  bars: OhlcvBar[]
  barsMatch: boolean
}): number | null {
  if (typeof opts.stored === 'number' && Number.isFinite(opts.stored)) return opts.stored
  if (!opts.barsMatch || opts.bars.length === 0) return null
  const last = opts.bars[opts.bars.length - 1]
  const price =
    opts.price != null && Number.isFinite(opts.price) && opts.price > 0
      ? opts.price
      : last && Number.isFinite(last.c)
        ? last.c
        : null
  const sma50 =
    opts.sma50 != null && Number.isFinite(opts.sma50)
      ? opts.sma50
      : smaClose(opts.bars.map((b) => b.c), SMA_PERIODS.sma50)
  const adrPct =
    opts.adrPct != null && Number.isFinite(opts.adrPct) && opts.adrPct > 0
      ? opts.adrPct
      : adrPctFromChartBars(opts.bars)
  if (price == null || sma50 == null || adrPct == null) return null
  return roundExtensionAdr50(extensionAdrFrom50(price, sma50, adrPct))
}

function ext50ChartChipClass(value: number | null): string {
  const tone = extensionAdr50Tone(value)
  const base = 'min-h-10 rounded-full border px-3 text-[11px] font-mono'
  if (tone === 'green') return `${base} border-terminal-green/40 bg-terminal-green/15 text-terminal-green`
  if (tone === 'amber') return `${base} border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber`
  if (tone === 'red') return `${base} border-terminal-red/40 bg-terminal-red-dim text-terminal-red`
  return `${base} border-terminal-border text-terminal-dim`
}

function buildMeasureMarkers(points: MeasurePoints): SeriesMarker<Time>[] {
  const rows: { time: number; text: string; color: string }[] = []
  const a = points.a
  const b = points.b
  if (a && b && a.time === b.time) {
    rows.push({ time: a.time, text: 'A B', color: '#e6edf3' })
  } else {
    if (a) rows.push({ time: a.time, text: 'A', color: '#38bdf8' })
    if (b) rows.push({ time: b.time, text: 'B', color: '#ffcc66' })
  }
  rows.sort((x, y) => x.time - y.time)
  return rows.map((row) => ({
    time: row.time as UTCTimestamp,
    position: 'aboveBar',
    shape: 'circle',
    color: row.color,
    text: row.text,
    size: 1,
  }))
}

function MeasureReadout({
  points,
  preview,
  onClear,
}: {
  points: MeasurePoints
  preview: MeasurePoint | null
  onClear: () => void
}) {
  const a = points.a
  if (!a) {
    return (
      <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-md border border-terminal-border bg-terminal-panel/95 px-2.5 py-2 font-mono text-[11px] text-terminal-muted">
        Click a candle for point A
      </div>
    )
  }
  const b = points.b ?? preview
  const live = points.b == null && preview != null
  if (!b) {
    return (
      <div className="pointer-events-none absolute right-2 top-2 z-10 max-w-[18rem] rounded-md border border-terminal-border bg-terminal-panel/95 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-terminal-fg">
        <div>
          A {a.date} {fmtPrice(a.close)}
        </div>
        <div className="text-terminal-muted">Click a second candle for point B</div>
        <button
          type="button"
          onClick={onClear}
          className="pointer-events-auto mt-1 min-h-10 rounded-md border border-terminal-border px-3 text-[11px] text-terminal-muted"
        >
          Clear
        </button>
      </div>
    )
  }
  const move = measurePctChange(a.close, b.close)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-2 top-2 z-10 max-w-[18rem] rounded-md border border-terminal-border bg-terminal-panel/95 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-terminal-fg shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
    >
      <div>
        A {a.date} {fmtPrice(a.close)}
      </div>
      <div>
        {live ? 'Preview' : 'B'} {b.date} {fmtPrice(b.close)}
      </div>
      {move ? (
        <div className={pctClass(move.pct)}>
          {fmtPct(move.pct, 2)} {fmtDollarChange(move.abs)}
        </div>
      ) : (
        <div className="text-terminal-dim">Percent needs a start close above 0</div>
      )}
      <button
        type="button"
        onClick={onClear}
        className="pointer-events-auto mt-1 min-h-10 rounded-md border border-terminal-border px-3 text-[11px] text-terminal-muted"
      >
        Clear
      </button>
    </div>
  )
}

function initialEnabled(): Record<SmaN, boolean> {
  const enabled = {} as Record<SmaN, boolean>
  for (const meta of SMA_META) enabled[meta.n] = meta.defaultOn
  return enabled
}

/**
 * Daily candlestick chart that fills its parent. Previous bars stay on screen
 * while a newer symbol loads. Responses from an older request are ignored.
 */
export default function DailyChartPanel({
  symbol,
  name,
  price,
  dayPct,
  extensionAdr50,
  adrPct,
  sma50,
}: Props) {
  const [enabled, setEnabled] = useState<Record<SmaN, boolean>>(initialEnabled)
  const [volSmaOn, setVolSmaOn] = useState(true)
  const [colors, setColors] = useState<SmaColorMap>(() => loadSmaColors())
  const [measureMode, setMeasureMode] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<MeasurePoints>(EMPTY_MEASURE)
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
  const volSmaRef = useRef<ISeriesApi<'Line'> | null>(null)
  const smaRef = useRef<Map<SmaN, ISeriesApi<'Line'>>>(new Map())
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const requestRef = useRef(0)
  const fittedBars = useRef<OhlcvBar[] | null>(null)
  const measureModeRef = useRef(false)

  const barsMatch = barsSymbol === symbol && bars.length > 0
  const showError = Boolean(error) && !loading
  const showSkeleton = !showError && bars.length === 0
  const showStale = !showError && !barsMatch && bars.length > 0
  const hideCanvas = showError || showSkeleton

  const lastHover = useMemo(
    () => hoverFromLastBar(bars, enabled, volSmaOn),
    [bars, enabled, volSmaOn],
  )
  const liveCrosshair = crosshair && crosshair.token === barsToken ? crosshair.hover : null
  const hover = barsMatch && !showError ? (liveCrosshair ?? lastHover) : null
  const measurePreview =
    measureMode && measurePoints.a && !measurePoints.b && liveCrosshair && barsMatch && !showError
      ? {
          time: liveCrosshair.time,
          date: barDate(liveCrosshair.time),
          close: liveCrosshair.close,
        }
      : null
  const chartExtensionAdr50 = useMemo(
    () =>
      resolveChartExtensionAdr50({
        stored: extensionAdr50,
        price,
        sma50,
        adrPct,
        bars,
        barsMatch,
      }),
    [extensionAdr50, price, sma50, adrPct, bars, barsMatch],
  )

  if (symbol !== activeSymbol) {
    setActiveSymbol(symbol)
    setLoading(true)
    setError(null)
    setMeasurePoints(EMPTY_MEASURE)
  }

  useEffect(() => {
    tokenRef.current = barsToken
  }, [barsToken])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !measureModeRef.current) return
      const target = e.target
      if (target instanceof HTMLInputElement && target.type === 'color') return
      e.preventDefault()
      measureModeRef.current = false
      setMeasureMode(false)
      setMeasurePoints(EMPTY_MEASURE)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

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
    volSmaRef.current = null
    smaRef.current = new Map()
    markersRef.current = null

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
        rightOffset: CHART_RIGHT_OFFSET_BARS,
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

    const onCrosshair = (param: MouseEventParams<Time>) => {
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
      const volSmaSeries = volSmaRef.current
      const volSmaPt = volSmaSeries
        ? (param.seriesData.get(volSmaSeries) as LineData | undefined)
        : undefined
      const time = eventTime(
        param.time,
        typeof candle.time === 'number' ? candle.time : 0,
      )
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
          volumeSma: volSmaPt && typeof volSmaPt.value === 'number' ? volSmaPt.value : null,
        },
      })
    }

    // Measure uses the clicked bar's close, not coordinateToPrice(cursor Y).
    // The close stays on a real print when the cursor sits between prices.
    const onChartClick = (param: MouseEventParams<Time>) => {
      if (!measureModeRef.current) return
      const candleSeries = candleRef.current
      if (!candleSeries || param.time == null) return
      const candle = param.seriesData.get(candleSeries) as CandlestickData | undefined
      if (!candle || typeof candle.close !== 'number' || !Number.isFinite(candle.close)) return
      const time = eventTime(param.time, typeof candle.time === 'number' ? candle.time : 0)
      const point: MeasurePoint = { time, date: barDate(time), close: candle.close }
      setMeasurePoints((prev) => {
        if (prev.a && prev.b) return prev
        if (!prev.a) return { a: point, b: null }
        return { a: prev.a, b: point }
      })
    }

    chart.subscribeCrosshairMove(onCrosshair)
    chart.subscribeClick(onChartClick)

    return () => {
      ro.disconnect()
      chart.unsubscribeClick(onChartClick)
      chart.unsubscribeCrosshairMove(onCrosshair)
      chart.remove()
      if (chartRef.current === chart) chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      volSmaRef.current = null
      smaRef.current = new Map()
      markersRef.current = null
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

    let volSma = volSmaRef.current
    if (volSmaOn) {
      if (!volSma) {
        volSma = chart.addSeries(LineSeries, {
          color: colors.vol20,
          lineWidth: 2,
          priceScaleId: 'volume',
          priceFormat: { type: 'volume' },
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        volSmaRef.current = volSma
      }
      volSma.applyOptions({ color: colors.vol20 })
      volSma.setData(
        volumeSmaSeries(bars, VOLUME_SMA_PERIOD)
          .filter((p): p is { time: number; value: number } => p.value != null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      )
    } else if (volSma) {
      chart.removeSeries(volSma)
      volSmaRef.current = null
    }

    const live = new Set<SmaN>()
    for (const meta of SMA_META) {
      if (!enabled[meta.n]) continue
      live.add(meta.n)
      let series = smaRef.current.get(meta.n)
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: colors[meta.key],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        smaRef.current.set(meta.n, series)
      }
      series.applyOptions({ color: colors[meta.key] })
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

    if (createdCandle || barsChanged) {
      // v5 fitContent includes options.rightOffset in the fitted range when
      // rightOffsetPixels is unset, then restores the scroll offset to that
      // option. Set it before the fit so the empty margin is part of the bar
      // spacing, and re-apply the same value after. Do not set rightOffsetPixels
      // (it overrides the bar count). Skip this on SMA toggles so a pan is kept.
      // applyOptions({ rightOffset }) also assigns the current scroll offset, so
      // it stays inside this fit path.
      chart.timeScale().applyOptions({ rightOffset: CHART_RIGHT_OFFSET_BARS })
      chart.timeScale().fitContent()
      chart.timeScale().applyOptions({ rightOffset: CHART_RIGHT_OFFSET_BARS })
    }
    // updateSmaColor / resetColors also call applyOptions immediately. `colors`
    // is a dependency so a saved colour is reapplied with the series data.
  }, [bars, enabled, volSmaOn, colors])

  useEffect(() => {
    const candle = candleRef.current
    if (!candle) return
    let plugin = markersRef.current
    if (!plugin) {
      plugin = createSeriesMarkers(candle, [], { autoScale: false })
      markersRef.current = plugin
    }
    plugin.setMarkers(buildMeasureMarkers(measureMode ? measurePoints : EMPTY_MEASURE))
  }, [measureMode, measurePoints, bars])

  function toggleSma(n: SmaN) {
    setEnabled((prev) => ({ ...prev, [n]: !prev[n] }))
  }

  function paintColor(key: SmaColorKey, color: string) {
    if (key === 'vol20') {
      volSmaRef.current?.applyOptions({ color })
      return
    }
    smaRef.current.get(Number(key) as SmaN)?.applyOptions({ color })
  }

  function updateSmaColor(key: SmaColorKey, value: string) {
    const next = parseSmaColors({ ...colors, [key]: value })
    setColors(next)
    saveSmaColors(next)
    paintColor(key, next[key])
  }

  function resetColors() {
    const next = parseSmaColors({})
    setColors(next)
    saveSmaColors(next)
    for (const meta of SMA_META) paintColor(meta.key, next[meta.key])
    paintColor('vol20', next.vol20)
  }

  function toggleMeasure() {
    const next = !measureModeRef.current
    measureModeRef.current = next
    setMeasurePoints(EMPTY_MEASURE)
    setMeasureMode(next)
  }

  function clearMeasure() {
    setMeasurePoints(EMPTY_MEASURE)
  }

  const priceLabel = price != null && Number.isFinite(price) ? fmtPrice(price) : null
  const dayLabel = dayPct != null && Number.isFinite(dayPct) ? fmtPct(dayPct) : null
  const chartInteractive = !hideCanvas && !showStale

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-terminal-bg">
      <header className="shrink-0 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <MetricTip id="ticker" className="font-mono text-lg font-bold text-terminal-fg">
            {symbol}
          </MetricTip>
          {name ? (
            <MetricTip id="name" className="truncate text-xs text-terminal-muted">
              {name}
            </MetricTip>
          ) : null}
          {priceLabel ? (
            <MetricTip id="price" className="font-mono text-sm text-terminal-fg">
              {priceLabel}
            </MetricTip>
          ) : null}
          {dayLabel ? (
            <MetricTip id="dayPct" className={`font-mono text-sm ${pctClass(dayPct ?? 0)}`}>
              {dayLabel}
            </MetricTip>
          ) : null}
          <MetricTip id="chartDaily" className="text-[10px] uppercase tracking-wide text-terminal-dim">
            Daily
          </MetricTip>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {SMA_META.map((meta) => {
            const on = enabled[meta.n]
            const color = colors[meta.key]
            return (
              <span key={meta.n} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleSma(meta.n)}
                  aria-pressed={on}
                  {...metricTipAttrs(
                    meta.n === SMA_PERIODS.sma10
                      ? 'chartSma10'
                      : meta.n === SMA_PERIODS.sma20
                        ? 'chartSma20'
                        : meta.n === SMA_PERIODS.sma50
                          ? 'chartSma50'
                          : 'chartSma200',
                  )}
                  className={chipClass(on)}
                  style={on ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}
                >
                  {meta.label}
                </button>
                <input
                  type="color"
                  aria-label={`${meta.label} colour`}
                  value={color}
                  onChange={(e) => updateSmaColor(meta.key, e.target.value)}
                  className={COLOR_INPUT_CLASS}
                />
              </span>
            )
          })}
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVolSmaOn((on) => !on)}
              aria-pressed={volSmaOn}
              {...metricTipAttrs('chartVolSma20')}
              className={chipClass(volSmaOn)}
              style={volSmaOn ? { boxShadow: `inset 0 -2px 0 ${colors.vol20}` } : undefined}
            >
              Vol SMA 20
            </button>
            <input
              type="color"
              aria-label="Vol SMA 20 colour"
              value={colors.vol20}
              onChange={(e) => updateSmaColor('vol20', e.target.value)}
              className={COLOR_INPUT_CLASS}
            />
          </span>
          <button
            type="button"
            onClick={toggleMeasure}
            aria-pressed={measureMode}
            {...metricTipAttrs('chartMeasure')}
            className={chipClass(measureMode)}
          >
            Measure
          </button>
          <button
            type="button"
            onClick={resetColors}
            {...metricTipAttrs('chartSmaColors')}
            className="min-h-10 cursor-help rounded-full border border-terminal-border px-3 text-[11px] font-mono text-terminal-dim"
          >
            Reset colours
          </button>
          <MetricTip
            id="extensionAdr50"
            extra={`${formatExtensionAdr50(chartExtensionAdr50)} ADR from the 50 SMA`}
            className={ext50ChartChipClass(chartExtensionAdr50)}
          >
            Ext. 50SMA {formatExtensionAdr50(chartExtensionAdr50)} ADR
          </MetricTip>
        </div>
      </header>

      {hover ? (
        <div className="shrink-0 px-3 py-1 font-mono text-[11px] text-terminal-muted sm:px-4">
          <MetricTip id="chartOhlc" className="text-terminal-fg">
            {barDate(hover.time)}
            {'  '}O {fmtPrice(hover.open)} H {fmtPrice(hover.high)} L {fmtPrice(hover.low)} C{' '}
            {fmtPrice(hover.close)}
          </MetricTip>
          {hover.volume != null ? (
            <MetricTip id="chartVolume"> V {fmtVol(hover.volume)}</MetricTip>
          ) : null}
          {volSmaOn && hover.volumeSma != null ? (
            <MetricTip id="chartVolSma20" style={{ color: colors.vol20 }}>
              {'  '}
              V20:{fmtVol(hover.volumeSma)}
            </MetricTip>
          ) : null}
          {SMA_META.filter((m) => enabled[m.n] && hover.sma[m.n] != null).map((m) => (
            <MetricTip
              key={m.n}
              id={
                m.n === SMA_PERIODS.sma10
                  ? 'chartSma10'
                  : m.n === SMA_PERIODS.sma20
                    ? 'chartSma20'
                    : m.n === SMA_PERIODS.sma50
                      ? 'chartSma50'
                      : 'chartSma200'
              }
              style={{ color: colors[m.key] }}
            >
              {'  '}
              {m.n}:{fmtPrice(hover.sma[m.n]!)}
            </MetricTip>
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
        {chartInteractive && measureMode ? (
          <MeasureReadout points={measurePoints} preview={measurePreview} onClear={clearMeasure} />
        ) : null}
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
