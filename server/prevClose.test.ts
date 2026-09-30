import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { resolvePrevClose } from '../src/lib/prevClose.ts'
import { parseYahooChart } from './marketProxy.ts'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface SymbolSample {
  regularMarketPrice: number
  chartPreviousClose: number
  previousClose: number | null
  regularMarketTime: number
  gmtoffset: number
  exchangeTimezoneName: string
  regularPeriodStart: number
  regularPeriodEnd: number
  bars: Bar[]
  chart1d?: {
    chartPreviousClose: number
    previousClose: number | null
    regularMarketPrice: number
    regularMarketTime: number
    bars: Bar[]
  }
  chart5d?: {
    chartPreviousClose: number
    previousClose: number | null
    regularMarketPrice: number
    regularMarketTime: number
    bars: Bar[]
  }
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-chart-prevclose-sample.json'), 'utf8'),
) as {
  label: string
  symbols: Record<string, SymbolSample>
}

function dayPct(price: number, prev: number): number {
  return (price / prev - 1) * 100
}

function toYahooRaw(sample: SymbolSample, previousClose?: number) {
  const meta: Record<string, unknown> = {
    regularMarketPrice: sample.regularMarketPrice,
    chartPreviousClose: sample.chartPreviousClose,
    regularMarketTime: sample.regularMarketTime,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
    currentTradingPeriod: {
      regular: {
        start: sample.regularPeriodStart,
        end: sample.regularPeriodEnd,
        gmtoffset: sample.gmtoffset,
      },
    },
  }
  if (previousClose != null) meta.previousClose = previousClose
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: sample.bars.map((bar) => bar.t),
          indicators: {
            quote: [
              {
                open: sample.bars.map((bar) => bar.o),
                high: sample.bars.map((bar) => bar.h),
                low: sample.bars.map((bar) => bar.l),
                close: sample.bars.map((bar) => bar.c),
                volume: sample.bars.map((bar) => bar.v),
              },
            ],
          },
        },
      ],
    },
  }
}

function clock(sample: SymbolSample) {
  return {
    regularMarketTime: sample.regularMarketTime,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
    currentTradingPeriod: {
      regular: {
        start: sample.regularPeriodStart,
        end: sample.regularPeriodEnd,
        gmtoffset: sample.gmtoffset,
      },
    },
  }
}

test('fixture is a real-data sample of Yahoo 1y charts', () => {
  assert.equal(fixture.label, 'real-data sample')
  assert.ok(fixture.symbols.PBF)
  assert.ok(fixture.symbols.MPC)
  assert.ok(fixture.symbols.CVI)
  assert.equal(fixture.symbols.PBF?.previousClose, null)
  assert.equal(fixture.symbols.PBF?.chartPreviousClose, 30.17)
})

for (const symbol of ['PBF', 'MPC', 'CVI'] as const) {
  test(`${symbol} 1y chart: prev close is the prior session, not chartPreviousClose`, () => {
    const sample = fixture.symbols[symbol]!
    const parsed = parseYahooChart(toYahooRaw(sample), symbol, '1y')
    const prior = sample.bars[sample.bars.length - 2]!.c
    const last = sample.bars[sample.bars.length - 1]!.c
    assert.equal(parsed.bars.length, sample.bars.length)
    assert.equal(parsed.prevClose, prior)
    assert.notEqual(parsed.prevClose, sample.chartPreviousClose)
    // The live print matches the forming/completed last bar; day change is vs the bar before it.
    assert.ok(Math.abs(parsed.price - sample.regularMarketPrice) < 1e-6)
    assert.ok(Math.abs(parsed.price - last) / last < 0.001)

    const actual = dayPct(parsed.price, parsed.prevClose)
    const fromBars = dayPct(parsed.price, prior)
    assert.ok(Math.abs(actual) < 15, `dayPct ${actual} for ${symbol}`)
    assert.ok(Math.abs(actual - fromBars) < 0.02, `${actual} vs ${fromBars}`)
    // The buggy year-ago baseline is still in the fixture and is not a 1D move.
    assert.ok(Math.abs(dayPct(parsed.price, sample.chartPreviousClose)) > 25)
  })
}

test('previousClose is kept when it is within 25% of the prior bar', () => {
  const sample = fixture.symbols.PBF!
  const prior = sample.bars[sample.bars.length - 2]!.c
  const sane = prior * 1.02
  const prev = resolvePrevClose({
    bars: sample.bars,
    price: sample.regularMarketPrice,
    metaPreviousClose: sane,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, sane)
  const parsed = parseYahooChart(toYahooRaw(sample, sane), 'PBF', '1y')
  assert.equal(parsed.prevClose, sane)
})

test('insane previousClose is ignored in favor of the prior bar', () => {
  const sample = fixture.symbols.PBF!
  const prior = sample.bars[sample.bars.length - 2]!.c
  const insane = prior * 1.4
  const prev = resolvePrevClose({
    bars: sample.bars,
    price: sample.regularMarketPrice,
    metaPreviousClose: insane,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, prior)
  assert.ok(Math.abs(dayPct(sample.regularMarketPrice, insane)) < 60)
  const parsed = parseYahooChart(toYahooRaw(sample, sample.chartPreviousClose), 'PBF', '1y')
  assert.equal(parsed.prevClose, prior)
})

test('chartPreviousClose is ignored for a 1y range', () => {
  const sample = fixture.symbols.MPC!
  const prior = sample.bars[sample.bars.length - 2]!.c
  const prev = resolvePrevClose({
    bars: sample.bars,
    price: sample.regularMarketPrice,
    metaPreviousClose: null,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, prior)
  assert.notEqual(prev, sample.chartPreviousClose)
})

test('chartPreviousClose is ignored for a 5d range even when it is near the prior bar', () => {
  const sample = fixture.symbols.PBF!
  const prior = sample.bars[sample.bars.length - 2]!.c
  const chart5d = sample.chart5d!.chartPreviousClose
  assert.ok(Math.abs(chart5d / prior - 1) <= 0.25)
  assert.ok(Math.abs(dayPct(sample.regularMarketPrice, chart5d)) < 15)
  const prev = resolvePrevClose({
    bars: sample.bars,
    price: sample.regularMarketPrice,
    metaChartPreviousClose: chart5d,
    range: '5d',
    ...clock(sample),
  })
  assert.equal(prev, prior)
  assert.notEqual(prev, chart5d)
})

test('chartPreviousClose is the prior close for a 1d chart with a single session bar', () => {
  const sample = fixture.symbols.PBF!
  const one = sample.chart1d!
  assert.equal(one.bars.length, 1)
  assert.equal(one.previousClose, null)
  const prev = resolvePrevClose({
    bars: one.bars,
    price: one.regularMarketPrice,
    metaChartPreviousClose: one.chartPreviousClose,
    range: '1d',
    regularMarketTime: one.regularMarketTime,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
  })
  assert.equal(prev, one.chartPreviousClose)
  assert.ok(Math.abs(dayPct(one.regularMarketPrice, prev!)) < 15)
})

test('only two bars: previous close is the earlier close, chartPreviousClose stays ignored', () => {
  const sample = fixture.symbols.CVI!
  const two = sample.bars.slice(-2)
  assert.equal(two.length, 2)
  const prev = resolvePrevClose({
    bars: two,
    price: two[1]!.c,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, two[0]!.c)
  const move = dayPct(two[1]!.c, prev!)
  assert.ok(Math.abs(move) < 15)
  assert.ok(Math.abs(move - dayPct(two[1]!.c, two[0]!.c)) < 0.02)
})

test('market hours: last bar is today and price differs from its close', () => {
  const sample = fixture.symbols.PBF!
  const prior = sample.bars[sample.bars.length - 2]!.c
  const last = sample.bars[sample.bars.length - 1]!.c
  const price = last * 1.004
  const prev = resolvePrevClose({
    bars: sample.bars,
    price,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, prior)
  assert.ok(Math.abs(dayPct(price, prev!)) < 15)
})

test('after hours: last bar close equals price, including when the clock is the next session', () => {
  const sample = fixture.symbols.MPC!
  const prior = sample.bars[sample.bars.length - 2]!.c
  const last = sample.bars[sample.bars.length - 1]!.c
  const atClose = resolvePrevClose({
    bars: sample.bars,
    price: last,
    range: '1y',
    ...clock(sample),
    regularMarketTime: sample.regularPeriodEnd,
  })
  assert.equal(atClose, prior)

  const nextSession = resolvePrevClose({
    bars: sample.bars,
    price: last,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
    regularMarketTime: sample.regularPeriodStart + 86400,
  })
  assert.equal(nextSession, prior)
  assert.notEqual(nextSession, last)
})

test('bars lag the live session: previous close is the last completed bar', () => {
  const sample = fixture.symbols.PBF!
  const lagged = sample.bars.slice(0, -1)
  const completed = lagged[lagged.length - 1]!.c
  const older = lagged[lagged.length - 2]!.c
  const prev = resolvePrevClose({
    bars: lagged,
    price: sample.regularMarketPrice,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, completed)
  assert.notEqual(prev, older)
  assert.ok(Math.abs(dayPct(sample.regularMarketPrice, prev!)) < 15)
})

test('a previous close that implies |dayPct| > 60% loses to a small bar move', () => {
  const sample = fixture.symbols.PBF!
  // 09:30 America/New_York on the sessions around the real sample.
  const sep28 = sample.regularPeriodStart - 2 * 86400
  const sep29 = sample.regularPeriodStart - 86400
  const prev = resolvePrevClose({
    bars: [
      { t: sep28, c: 100 },
      { t: sep29, c: 124 },
    ],
    price: 130,
    metaPreviousClose: 80,
    range: '1y',
    regularMarketTime: sample.regularMarketTime,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
  })
  assert.equal(prev, 124)
  assert.ok(Math.abs(dayPct(130, 80)) > 60)
  assert.ok(Math.abs(dayPct(130, 124)) <= 15)
})

test('a real large gap is not clamped', () => {
  const sample = fixture.symbols.PBF!
  const open = sample.regularPeriodStart
  const prev = resolvePrevClose({
    bars: [
      { t: open - 86400, c: 100 },
      { t: open, c: 170 },
    ],
    price: 170,
    metaPreviousClose: 102,
    range: '1y',
    ...clock(sample),
  })
  assert.equal(prev, 102)
  assert.ok(Math.abs(dayPct(170, prev!)) > 60)
})
