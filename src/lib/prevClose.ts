/**
 * Prior regular-session close for 1D change.
 *
 * Yahoo's `meta.chartPreviousClose` is the close before the requested range.
 * On `range=1y` that is about a year ago, not yesterday. It is a valid
 * prior-session close only for `range=1d`. `meta.previousClose` is used only
 * when it sits near the daily bars.
 *
 * `prevClose` is the close of the session immediately before the session that
 * produced `price`:
 * - last bar is that session (or its close equals `price`) → `bars[n-2].c`
 * - last bar is an earlier session → `bars[n-1].c`
 */

export interface PrevCloseBar {
  t: number
  c: number
}

export interface ResolvePrevCloseInput {
  bars: PrevCloseBar[]
  price: number
  metaPreviousClose?: number | null
  metaChartPreviousClose?: number | null
  /** Yahoo chart range (`1d`, `5d`, `1y`, …). Chart previous close is trusted only for `1d`. */
  range?: string | null
  regularMarketTime?: number | null
  /** Exchange offset in seconds (Yahoo `meta.gmtoffset`), e.g. -14400 for EDT. */
  gmtoffset?: number | null
  exchangeTimezoneName?: string | null
  currentTradingPeriod?: {
    regular?: { start?: number; end?: number; gmtoffset?: number }
  } | null
}

/** |candidate/reference − 1| must be within this or the quote field is ignored. */
const ANCHOR_RATIO = 0.25
/** Drop a quote-field previous close when it implies a move this large… */
const INSANE_DAY_MOVE = 0.6
/** …and the daily bars imply a move no larger than this. */
const SMALL_BAR_MOVE = 0.15

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function withinRatio(candidate: number, reference: number, ratio = ANCHOR_RATIO): boolean {
  if (!(candidate > 0) || !(reference > 0)) return false
  return Math.abs(candidate / reference - 1) <= ratio
}

/** True when two prints are the same price aside from float / cent rounding. */
function pricesEqual(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false
  const diff = Math.abs(a - b)
  const scale = Math.max(a, b)
  return diff <= Math.max(0.02, scale * 0.0005)
}

function sessionDateKey(
  unixSec: number | null | undefined,
  timeZone: string | null | undefined,
  gmtoffsetSec: number | null | undefined,
): string | null {
  if (unixSec == null || !Number.isFinite(unixSec) || unixSec <= 0) return null
  const zone = timeZone?.trim()
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(unixSec * 1000))
      const year = parts.find((p) => p.type === 'year')?.value
      const month = parts.find((p) => p.type === 'month')?.value
      const day = parts.find((p) => p.type === 'day')?.value
      if (year && month && day) return `${year}-${month}-${day}`
    } catch {
      // Unknown zone name — use the numeric offset below.
    }
  }
  if (gmtoffsetSec != null && Number.isFinite(gmtoffsetSec)) {
    return new Date((unixSec + gmtoffsetSec) * 1000).toISOString().slice(0, 10)
  }
  return null
}

export type PriceClock = Pick<
  ResolvePrevCloseInput,
  'regularMarketTime' | 'gmtoffset' | 'exchangeTimezoneName' | 'currentTradingPeriod'
>

function priceSessionDate(input: PriceClock, gmtoffset: number | null): string | null {
  const zone = input.exchangeTimezoneName
  const fromTrade = sessionDateKey(input.regularMarketTime, zone, gmtoffset)
  if (fromTrade) return fromTrade
  return sessionDateKey(input.currentTradingPeriod?.regular?.start, zone, gmtoffset)
}

function clockOffset(input: PriceClock): number | null {
  return (
    (typeof input.gmtoffset === 'number' && Number.isFinite(input.gmtoffset)
      ? input.gmtoffset
      : null) ??
    (typeof input.currentTradingPeriod?.regular?.gmtoffset === 'number'
      ? input.currentTradingPeriod.regular.gmtoffset
      : null)
  )
}

export function filterPerfBars<T extends PrevCloseBar>(bars: T[]): T[] {
  return bars
    .filter((bar) => Number.isFinite(bar.t) && Number.isFinite(bar.c) && bar.c > 0)
    .sort((a, b) => a.t - b.t)
}

/**
 * Index of the last completed bar strictly before the session that produced
 * `price`. `series` is already filtered and sorted. Null when that bar does
 * not exist.
 *
 * The last bar is the price session when its close equals `price` or its
 * exchange date matches the price timestamp. When the last bar's date is
 * strictly earlier, that bar is already a completed session before `price`.
 * With no usable clock, the last bar is treated as the price session.
 */
function immediatePriorIndex(
  series: PrevCloseBar[],
  price: number,
  input: PriceClock,
): number | null {
  if (!series.length) return null
  const gmtoffset = clockOffset(input)
  const zone = input.exchangeTimezoneName
  const priceDate = priceSessionDate(input, gmtoffset)

  if (series.length === 1) {
    const only = series[0]!
    const onlyDate = sessionDateKey(only.t, zone, gmtoffset)
    if (
      priceDate &&
      onlyDate &&
      onlyDate < priceDate &&
      !(price > 0 && pricesEqual(price, only.c))
    ) {
      return 0
    }
    return null
  }

  const last = series[series.length - 1]!
  const lastDate = sessionDateKey(last.t, zone, gmtoffset)
  if (price > 0 && pricesEqual(price, last.c)) return series.length - 2
  if (priceDate && lastDate && lastDate === priceDate) return series.length - 2
  if (priceDate && lastDate && lastDate < priceDate) return series.length - 1
  return series.length - 2
}

export interface PriceSessionPlacement<T extends PrevCloseBar = PrevCloseBar> {
  series: T[]
  /** Index of the session that produced `price`, or `series.length` when that bar is absent. */
  priceIndex: number
}

export function placePriceSession<T extends PrevCloseBar>(
  bars: T[],
  price: number,
  input: PriceClock = {},
): PriceSessionPlacement<T> | null {
  const series = filterPerfBars(bars)
  const prior = immediatePriorIndex(series, price, input)
  if (prior == null) return null
  return { series, priceIndex: prior + 1 }
}

/** Close `sessions` completed daily bars before the session that produced `price`. */
export function closeSessionsBeforePrice(
  bars: PrevCloseBar[],
  price: number,
  sessions: number,
  input: PriceClock = {},
): number | null {
  if (!Number.isInteger(sessions) || sessions < 1) return null
  const placed = placePriceSession(bars, price, input)
  if (!placed) return null
  const idx = placed.priceIndex - sessions
  if (idx < 0 || idx >= placed.series.length) return null
  const close = placed.series[idx]!.c
  return close > 0 ? close : null
}

function barDerivedPrevClose(
  series: PrevCloseBar[],
  price: number,
  input: ResolvePrevCloseInput,
): number | null {
  const idx = immediatePriorIndex(series, price, input)
  if (idx == null) return null
  return series[idx]!.c
}

/**
 * Previous regular-session close, or null when the bars and quote fields
 * cannot support one. Does not invent a flat day.
 */
export function resolvePrevClose(input: ResolvePrevCloseInput): number | null {
  const series = input.bars
    .filter((bar) => Number.isFinite(bar.t) && Number.isFinite(bar.c) && bar.c > 0)
    .sort((a, b) => a.t - b.t)
  const price = positive(input.price) ?? 0
  const barPrev = barDerivedPrevClose(series, price, input)
  const anchor = series.length >= 2 ? series[series.length - 2]!.c : null
  const metaPrev = positive(input.metaPreviousClose)
  const chartPrev = positive(input.metaChartPreviousClose)
  const range = (input.range ?? '').trim().toLowerCase()
  // chartPreviousClose on range=5d/1y/… is the close before that window.
  const chartIsPriorSession = range === '1d'

  const metaSane =
    metaPrev != null && (anchor == null || withinRatio(metaPrev, anchor))

  let chosen: number | null = null
  if (metaSane && metaPrev != null) chosen = metaPrev
  else if (barPrev != null) chosen = barPrev
  else if (
    chartIsPriorSession &&
    chartPrev != null &&
    (anchor == null || withinRatio(chartPrev, anchor))
  ) {
    chosen = chartPrev
  }

  if (chosen != null && barPrev != null && price > 0 && chosen !== barPrev) {
    const quoteMove = Math.abs(price / chosen - 1)
    const barMove = Math.abs(price / barPrev - 1)
    if (quoteMove > INSANE_DAY_MOVE && barMove <= SMALL_BAR_MOVE) chosen = barPrev
  }

  return chosen
}
